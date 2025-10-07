import { EJSON } from 'bson';
import {
  type AnyBulkWriteOperation,
  type BulkWriteOptions,
  type BulkWriteResult,
  type ClientSession,
  type Collection,
  type Document,
  type Filter,
  type FindOptions,
  type InferIdType,
  type MongoClient,
  MongoNetworkError,
  MongoServerClosedError,
  MongoServerSelectionError,
  MongoTopologyClosedError,
  type OptionalUnlessRequiredId,
} from 'mongodb';

import { debug, objectIdToString, stringToObjectId } from './helpers';
import type {
  CacheFunction,
  Options,
  QueryOptions,
  UpdateOptions,
} from './types';

export default class MongoWrapper<T extends Document = Document> {
  protected options: Options;
  protected cache?: CacheFunction;
  protected client: MongoClient;
  protected session?: ClientSession;

  constructor(options: Options, session?: ClientSession) {
    this.options = options;
    this.client = options.client;
    this.cache = options.cache;
    this.session = session;
  }

  protected async onInsert<T extends Document>(document: T): Promise<T> {
    const onInsert = await this.options.setOnInsert?.(
      this.options.collection,
      document,
    );

    if (onInsert) {
      return { ...document, ...onInsert };
    }

    return document;
  }

  protected async onUpdate(
    update: Document,
    skipSetOnUpdate: boolean,
  ): Promise<Document> {
    if (skipSetOnUpdate || Array.isArray(update)) {
      return update;
    }

    const onUpdate = await this.options.setOnUpdate?.(
      this.options.collection,
      update,
    );

    const onInsert = await this.options.setOnInsert?.(
      this.options.collection,
      update,
    );

    if (onUpdate) {
      update['$set'] ||= {};
      update['$set'] = { ...update['$set'], ...onUpdate };
    }

    if (onInsert) {
      const entries = Object.entries(onInsert).filter(
        ([key]) => update?.['$set']?.[key] === undefined,
      );

      if (entries.length > 0) {
        update['$setOnInsert'] ||= {};
        update['$setOnInsert'] = {
          ...update['$setOnInsert'],
          ...Object.fromEntries(entries),
        };
      }
    }

    return update;
  }

  // Static decorator factory for caching and logging
  private static withCacheAndLogging<
    R,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends (...args: any[]) => Promise<R>,
  >(isMutation: boolean = false) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _target: any,
      propertyKey: string,
      descriptor: TypedPropertyDescriptor<T>,
    ) => {
      const originalMethod = descriptor.value!;

      const fn = async function (
        this: MongoWrapper<Document>,
        ...args: Parameters<T>
      ): Promise<R> {
        const operation = (): Promise<R> => originalMethod.apply(this, args);

        // Extract options for cache control from the last argument if it exists
        const lastArg = args[args.length - 1];
        const cacheOptions =
          lastArg && typeof lastArg === 'object' && 'cache' in lastArg
            ? { cache: lastArg.cache as boolean | undefined }
            : {};

        return this.executeWithCacheAndLogging(
          propertyKey,
          operation,
          args,
          cacheOptions,
          isMutation,
        );
      };

      descriptor.value = fn as T;

      return descriptor;
    };
  }

  private async executeWithCacheAndLogging<R>(
    method: string,
    operation: () => Promise<R>,
    args: unknown[],
    options?: { cache?: boolean },
    isMutation: boolean = false,
    retry: boolean = false,
  ): Promise<R> {
    let response: R;
    const time = performance.now();

    try {
      if (
        options?.cache === false ||
        !this.cache ||
        isMutation ||
        !!this.session
      ) {
        response = await operation();
      } else {
        const ejson = await this.cache(
          () => operation().then(EJSON.serialize),
          [
            method,
            this.options.collection,
            ...args.map(x => Buffer.from(JSON.stringify(x)).toString('base64')),
          ],
          {
            tags: [this.options.collection],
          },
        )();

        response = EJSON.deserialize(ejson);
      }

      // Handle mutations
      if (isMutation) {
        await this.onMutation(method);
      }

      // Success logging
      if (this.options.debug) {
        debug({
          method,
          ms: performance.now() - time,
          name: this.options.collection,
          parameters: {
            args,
            options,
          },
          status: 'SUCCESS',
        });
      }

      return response;
    } catch (error) {
      const isRetryable =
        error instanceof MongoNetworkError ||
        error instanceof MongoServerSelectionError ||
        error instanceof MongoTopologyClosedError ||
        error instanceof MongoServerClosedError;

      // Retry the operation
      if (!retry && isRetryable) {
        await new Promise(res => setTimeout(res, 1000));
        try {
          await this.client.close();
        } catch (closeError) {
          // Ignore close errors
        }

        await this.client.connect();

        return this.executeWithCacheAndLogging(
          method,
          operation,
          args,
          options,
          isMutation,
          true,
        );
      }

      // Error logging
      if (this.options.debug) {
        this.onError({
          action: method,
          parameters: { args, error, options },
        })(error as Error);
      }

      throw error;
    }
  }

  async db(): Promise<Collection<T>> {
    return this.client
      .db(this.options.database)
      .collection(this.options.collection);
  }

  protected onMutation = async (action: string): Promise<void> => {
    if (this.options.onMutation) {
      await this.options.onMutation({
        action,
        collection: this.options.collection,
      });
    }
  };

  // Query operations (cacheable, non-mutation)
  @MongoWrapper.withCacheAndLogging(false)
  public async findOne<R extends Document = T>(
    filter: Filter<T>,
    options: { projection?: FindOptions<T>['projection'] } & QueryOptions = {},
  ): Promise<R | null> {
    return (await this.db())
      .findOne<R>(this.sto(filter), {
        projection: options.projection,
        session: this.session,
      })
      .then(result => this.ots(result))
      .catch(
        this.onError({
          action: 'findOne',
          parameters: { filter, options },
        }),
      );
  }

  @MongoWrapper.withCacheAndLogging(false)
  public async find<R extends Document = T>(
    filter: Filter<T> = {},
    options: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'> &
      QueryOptions = {},
  ): Promise<R[]> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cache, ...opts } = options;
    const cursor = (await this.db()).find<R>(this.sto(filter), {
      ...opts,
      session: this.session,
    });
    const result = await cursor
      .toArray()
      .catch(this.onError({ action: 'find', parameters: { filter, options } }));

    await cursor.close();
    return this.ots(result);
  }

  @MongoWrapper.withCacheAndLogging(false)
  public async distinct<R = string>(
    field: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: QueryOptions = {},
  ): Promise<R[]> {
    return (await this.db())
      .distinct(field)
      .catch(this.onError({ action: 'distinct', parameters: { field } }))
      .then(result => this.ots(result) as R[]);
  }

  @MongoWrapper.withCacheAndLogging(false)
  public async aggregate<R extends Document = Document>(
    pipeline: Document[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: QueryOptions = {},
  ): Promise<R[]> {
    const cursor = (await this.db()).aggregate<R>(this.sto(pipeline), {
      session: this.session,
    });
    const result = await cursor
      .toArray()
      .catch(this.onError({ action: 'aggregate', parameters: { pipeline } }));

    await cursor.close();
    return this.ots(result);
  }

  @MongoWrapper.withCacheAndLogging(false)
  public async count(
    filter: Filter<T> = {},
    options: QueryOptions = {},
  ): Promise<number> {
    return (await this.db())
      .countDocuments(this.sto(filter), { session: this.session })
      .catch(
        this.onError({ action: 'count', parameters: { filter, options } }),
      );
  }

  // Mutation operations (non-cacheable, triggers onMutation)
  @MongoWrapper.withCacheAndLogging(true)
  public async insertOne(
    document: OptionalUnlessRequiredId<T>,
  ): Promise<{ insertedId: InferIdType<T> }> {
    return (await this.db())
      .insertOne(this.sto(await this.onInsert(document)), {
        session: this.session,
      })
      .catch(this.onError({ action: 'insertOne', parameters: { document } }))
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async insertMany(
    documents: OptionalUnlessRequiredId<T>[],
  ): Promise<{ insertedIds: InferIdType<T>[] }> {
    const docs = await Promise.all(documents.map(doc => this.onInsert(doc)));
    return (await this.db())
      .insertMany(this.sto(docs), { session: this.session })
      .catch(this.onError({ action: 'insertMany', parameters: { documents } }))
      .then(({ insertedIds }) => ({ insertedIds: Object.values(insertedIds) }))
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async updateOne(
    filter: Filter<T>,
    update: object,
    { skipSetOnUpdate = false, upsert = false }: UpdateOptions = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return (await this.db())
      .updateOne(
        this.sto(filter),
        this.sto(await this.onUpdate(update, skipSetOnUpdate)),
        { upsert, session: this.session },
      )
      .catch(
        this.onError({ action: 'updateOne', parameters: { filter, update } }),
      )
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async updateMany(
    filter: Filter<T>,
    update: object,
    { skipSetOnUpdate = false, upsert = false }: UpdateOptions = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return (await this.db())
      .updateMany(
        this.sto(filter),
        this.sto(await this.onUpdate(update, skipSetOnUpdate)),
        { upsert, session: this.session },
      )
      .catch(
        this.onError({ action: 'updateMany', parameters: { filter, update } }),
      )
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }> {
    return (await this.db())
      .deleteOne(this.sto(filter), { session: this.session })
      .catch(this.onError({ action: 'deleteOne', parameters: { filter } }))
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async deleteMany(
    filter: Filter<T>,
  ): Promise<{ deletedCount: number }> {
    return (await this.db())
      .deleteMany(this.sto(filter), { session: this.session })
      .catch(this.onError({ action: 'deleteMany', parameters: { filter } }))
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async findOneAndUpdate<R extends Document = T>(
    filter: Filter<T>,
    update: object,
    options: {
      projection?: FindOptions<T>['projection'];
      returnDocument?: 'before' | 'after';
      skipSetOnUpdate?: boolean;
      sort?: FindOptions<T>['sort'];
      upsert?: boolean;
    } & QueryOptions = {},
  ): Promise<R | null> {
    const { skipSetOnUpdate = false, ..._options } = options;
    return (await this.db())
      .findOneAndUpdate(
        this.sto(filter),
        this.sto(await this.onUpdate(update, skipSetOnUpdate)),
        {
          ..._options,
          returnDocument: _options.returnDocument || 'after',
          session: this.session,
        },
      )
      .catch(
        this.onError({
          action: 'findOneAndUpdate',
          parameters: { filter, options, update },
        }),
      )
      .then(result => (result ? this.ots(result.value) : null));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async bulkWrite(
    operations: AnyBulkWriteOperation<T>[],
    options?: BulkWriteOptions & { skipSetOnUpdate?: boolean },
  ): Promise<BulkWriteResult> {
    const { skipSetOnUpdate = false, ...opts } = options || {};
    return (await this.db())
      .bulkWrite(
        this.sto(
          await Promise.all(
            operations.map(async op => {
              if ('insertOne' in op) {
                return {
                  insertOne: {
                    document: await this.onInsert(op.insertOne.document),
                  },
                };
              }

              if ('updateOne' in op) {
                return {
                  updateOne: {
                    ...op.updateOne,
                    update: await this.onUpdate(
                      op.updateOne.update,
                      skipSetOnUpdate,
                    ),
                  },
                };
              }

              if ('updateMany' in op) {
                return {
                  updateMany: {
                    ...op.updateMany,
                    update: await this.onUpdate(
                      op.updateMany.update,
                      skipSetOnUpdate,
                    ),
                  },
                };
              }

              return op;
            }),
          ),
        ),
        { ...opts, session: this.session },
      )
      .catch(
        this.onError({
          action: 'bulkWrite',
          parameters: { operations, options },
        }),
      )
      .then(result => this.ots(result));
  }

  // These methods don't need caching/logging as they're streaming or utility methods
  public async *cursor<R extends Document = Document>(
    pipeline: Document[],
  ): AsyncGenerator<R> {
    const cursor = (await this.db()).aggregate<R>(this.sto(pipeline), {
      session: this.session,
    });

    try {
      for await (const doc of cursor) {
        yield this.ots(doc);
      }
    } catch (error) {
      this.onError({ action: 'cursor', parameters: { pipeline } })(
        error as Error,
      );
    } finally {
      await cursor.close();
    }
  }

  public async *findCursor<R extends Document = T>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): AsyncGenerator<R> {
    const cursor = (await this.db()).find<R>(this.sto(filter), {
      ...options,
      session: this.session,
    });

    try {
      for await (const doc of cursor) {
        yield this.ots(doc);
      }
    } catch (error) {
      this.onError({ action: 'findCursor', parameters: { filter, options } })(
        error as Error,
      );
    } finally {
      await cursor.close();
    }
  }

  public async transaction(
    fn: (db: MongoWrapper<T>) => Promise<void>,
  ): Promise<void> {
    const session = await this.client.startSession();

    try {
      await session.withTransaction(async () => {
        await fn(
          new MongoWrapper<T>(
            {
              ...this.options,
              client: this.client,
            },
            session,
          ),
        );
      });
    } finally {
      await session.endSession();
    }
  }

  public async getClient(): Promise<Collection<T>> {
    return await this.db();
  }

  public async findById<R extends Document = T>(id: string): Promise<R | null> {
    return this.findOne({ _id: id } as Filter<T>);
  }

  protected ots<T>(obj: T): T {
    return objectIdToString(obj);
  }

  protected sto<T>(obj: T): T {
    return stringToObjectId(obj);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected onError(meta: Record<string, any>): (error: Error) => never {
    // Do not forward the real error
    // That might expose sensitive information

    const metadata = {
      collection: this.options.collection,
      database: this.options.database,
      ...meta,
    };

    return error => {
      if (this.options.onError) {
        this.options.onError(error, metadata);
      } else {
        console.error('MongoDB error:', {
          error,
          meta: metadata,
        });
      }

      throw new Error(
        'A database related error occurred. See the logs for detailed information.',
      );
    };
  }
}
