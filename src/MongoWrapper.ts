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
  private static reconnectionPromises = new Map<MongoClient, Promise<void>>();
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

  private async reconnect(): Promise<void> {
    const existingReconnection = MongoWrapper.reconnectionPromises.get(
      this.client,
    );

    if (existingReconnection) {
      await existingReconnection;
      return;
    }

    const reconnectionPromise = this.performReconnect();

    MongoWrapper.reconnectionPromises.set(this.client, reconnectionPromise);

    try {
      await reconnectionPromise;
    } finally {
      MongoWrapper.reconnectionPromises.delete(this.client);
    }
  }

  private async performReconnect(): Promise<void> {
    const maxRetries = this.options.retry?.maxRetries ?? 3;
    const initialDelay = this.options.retry?.initialDelayMs ?? 1000;
    const maxDelay = this.options.retry?.maxDelayMs ?? 10000;
    const backoffMultiplier = this.options.retry?.backoffMultiplier ?? 2;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Try to close the client gracefully
        try {
          await this.client.close();
        } catch (closeError) {
          // Ignore close errors - client might already be closed
        }

        // Calculate delay with exponential backoff
        if (attempt > 0) {
          const delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt - 1),
            maxDelay,
          );

          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Attempt to reconnect
        await this.client.connect();

        if (this.options.debug) {
          debug({
            method: 'reconnect',
            name: this.options.collection,
            status: 'SUCCESS',
            parameters: {
              attempt,
              retriesUsed: attempt,
            },
          });
        }

        return; // Success!
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          // eslint-disable-next-line no-console
          console.warn(
            `MongoDB reconnection attempt ${attempt + 1}/${maxRetries + 1} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    // All retries exhausted
    const errorMessage = `Failed to reconnect to MongoDB after ${maxRetries + 1} attempts`;
    // eslint-disable-next-line no-console
    console.error(errorMessage, lastError);
    throw new Error(
      `${errorMessage}: ${lastError?.message || 'Unknown error'}`,
    );
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
      // Connection/infrastructure errors that warrant reconnection and retry
      const connectionErrors = [
        'MongoNetworkError',
        'MongoServerSelectionError',
        'MongoNotConnectedError',
        'MongoClientClosedError',
        'MongoServerClosedError',
        'MongoPoolClosedError',
        'MongoNetworkTimeoutError',
        'MongoExpiredSessionError',
        'MongoTopologyClosedError',
      ];

      // Errors that should NEVER be retried (permanent failures)
      const nonRetryableErrors = [
        'MongoInvalidArgumentError', // Bad input from application code
        'MongoAPIError', // API misuse
        'MongoParseError', // Query syntax error
        'MongoAuthenticationError', // Wrong credentials
        'MongoMissingCredentialsError', // No credentials
        'MongoCompatibilityError', // Version mismatch
        'MongoCursorInExhaustedState', // Cursor already consumed
      ];

      const isConnectionError =
        error instanceof Error && connectionErrors.includes(error.name);

      const isPermanentError =
        error instanceof Error && nonRetryableErrors.includes(error.name);

      // Check if error has a code indicating a permanent failure
      const isDuplicateKeyError =
        error instanceof Error &&
        'code' in error &&
        (error.code === 11000 || error.code === 11001);

      const isRetryable =
        isConnectionError && !isPermanentError && !isDuplicateKeyError;

      // Don't retry operations within a session - sessions become invalid after reconnection
      const canRetry = !retry && isRetryable && !this.session;

      // Retry the operation
      if (canRetry) {
        // eslint-disable-next-line no-console
        console.info(
          `Retrying MongoDB operation "${method}" on collection "${this.options.collection}" due to ${error instanceof Error ? error.name : 'error'}:`,
          error instanceof Error ? error.message : error,
        );

        await this.reconnect();

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
      this.onError({
        action: method,
        parameters: { args, options },
      })(error as Error);

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
      .then(result => this.ots(result));
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
    const result = await cursor.toArray();

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
    const result = await cursor.toArray();

    await cursor.close();
    return this.ots(result);
  }

  @MongoWrapper.withCacheAndLogging(false)
  public async count(
    filter: Filter<T> = {},
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: QueryOptions = {},
  ): Promise<number> {
    return (await this.db()).countDocuments(this.sto(filter), {
      session: this.session,
    });
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
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async insertMany(
    documents: OptionalUnlessRequiredId<T>[],
  ): Promise<{ insertedIds: InferIdType<T>[] }> {
    const docs = await Promise.all(documents.map(doc => this.onInsert(doc)));
    return (await this.db())
      .insertMany(this.sto(docs), { session: this.session })
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
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }> {
    return (await this.db())
      .deleteOne(this.sto(filter), { session: this.session })
      .then(result => this.ots(result));
  }

  @MongoWrapper.withCacheAndLogging(true)
  public async deleteMany(
    filter: Filter<T>,
  ): Promise<{ deletedCount: number }> {
    return (await this.db())
      .deleteMany(this.sto(filter), { session: this.session })
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
