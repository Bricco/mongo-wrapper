import type {
  Collection,
  Db,
  Document,
  Filter,
  FindOptions,
  InferIdType,
  OptionalUnlessRequiredId,
} from 'mongodb';

import { BaseWrapper, QueryOptions, UpdateOptions } from './BaseWrapper';
import { onError } from './helpers';

export default class MongoDriverWrapper<
  T extends Document = Document,
> extends BaseWrapper<T> {
  async db(): Promise<Collection<T>> {
    if (!globalThis._connectionPromise) {
      if (process.env.NEXT_RUNTIME !== 'edge') {
        global._connectionPromise = new Promise<Db>(resolve => {
          import('mongodb').then(async ({ MongoClient }) => {
            const client = await MongoClient.connect(
              `${this.options.connectionString}?retryWrites=true&w=majority`,
            );

            resolve(client.db(this.options.database));
          });
        });
      } else {
        throw new Error('MongoDriverWrapper is not supported in edge runtime');
      }
    }

    return (await globalThis._connectionPromise).collection(
      this.options.collection,
    );
  }

  protected onMutation = async (action: string): Promise<void> => {
    if (this.options.onMutation) {
      await this.options.onMutation({
        collection: this.options.collection,
        action,
      });
    }
  };

  public async findOne<R extends Document = T>(
    filter: Filter<T>,
    options: { projection?: FindOptions<T>['projection'] } & QueryOptions = {},
  ): Promise<R | null> {
    return (await this.db())
      .findOne<R>(this.sto(filter), { projection: options.projection })
      .then(result => this.ots(result))
      .catch(onError);
  }

  public async find<R extends Document = T>(
    filter: Filter<T> = {},
    options: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'> &
      QueryOptions = {},
  ): Promise<R[]> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cache, ...opts } = options;
    const cursor = (await this.db()).find<R>(this.sto(filter), opts);
    const result = await cursor.toArray().catch(onError);

    await cursor.close();
    return this.ots(result);
  }

  public async insertOne(
    document: OptionalUnlessRequiredId<T>,
  ): Promise<{ insertedId: InferIdType<T> }> {
    return (await this.db())
      .insertOne(this.sto(await this.onInsert(document)))
      .catch(onError)
      .then(async result => {
        await this.onMutation('insertOne');
        return this.ots(result);
      });
  }

  public async insertMany(
    documents: OptionalUnlessRequiredId<T>[],
  ): Promise<{ insertedIds: InferIdType<T>[] }> {
    const docs = await Promise.all(documents.map(doc => this.onInsert(doc)));
    return (await this.db())
      .insertMany(this.sto(docs))
      .catch(onError)
      .then(({ insertedIds }) => ({ insertedIds: Object.values(insertedIds) }))
      .then(async result => {
        await this.onMutation('insertMany');
        return this.ots(result);
      });
  }

  public async updateOne(
    filter: Filter<T>,
    update: object,
    { skipSetOnUpdate = false, upsert = false }: UpdateOptions = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return (await this.db())
      .updateOne(
        this.sto(filter),
        this.sto(await this.onUpdate(update, skipSetOnUpdate)),
        {
          upsert,
        },
      )
      .catch(onError)
      .then(async result => {
        await this.onMutation('updateOne');
        return this.ots(result);
      });
  }

  public async updateMany(
    filter: Filter<T>,
    update: object,
    { skipSetOnUpdate = false, upsert = false }: UpdateOptions = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return (await this.db())
      .updateMany(
        this.sto(filter),
        this.sto(await this.onUpdate(update, skipSetOnUpdate)),
        { upsert },
      )
      .catch(onError)
      .then(async result => {
        await this.onMutation('updateMany');
        return this.ots(result);
      });
  }

  public async distinct<R = string>(field: string): Promise<R[]> {
    return (await this.db())
      .distinct(field)
      .catch(onError)
      .then(result => this.ots(result) as R[]);
  }

  public async deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }> {
    return (await this.db())
      .deleteOne(this.sto(filter))
      .catch(onError)
      .then(async result => {
        await this.onMutation('deleteOne');
        return this.ots(result);
      });
  }

  public async deleteMany(
    filter: Filter<T>,
  ): Promise<{ deletedCount: number }> {
    return (await this.db())
      .deleteMany(this.sto(filter))
      .catch(onError)
      .then(async result => {
        await this.onMutation('deleteMany');
        return this.ots(result);
      });
  }

  public async aggregate<R extends Document = Document>(
    pipeline: Document[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: QueryOptions = {},
  ): Promise<R[]> {
    const cursor = (await this.db()).aggregate<R>(this.sto(pipeline));
    const result = await cursor.toArray().catch(onError);

    await cursor.close();
    return this.ots(result);
  }

  public async *cursor<R extends Document = Document>(
    pipeline: Document[],
  ): AsyncGenerator<R> {
    const cursor = (await this.db()).aggregate<R>(this.sto(pipeline));

    try {
      for await (const doc of cursor) {
        yield this.ots(doc);
      }
    } catch (error) {
      onError(error);
    } finally {
      await cursor.close();
    }
  }

  public async *findCursor<R extends Document = T>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): AsyncGenerator<R> {
    const cursor = (await this.db()).find<R>(this.sto(filter), options);

    try {
      for await (const doc of cursor) {
        yield this.ots(doc);
      }
    } catch (error) {
      onError(error);
    } finally {
      await cursor.close();
    }
  }
}
