import type {
  Collection,
  Document,
  Filter,
  FindOptions,
  InferIdType,
  MongoClient,
  OptionalUnlessRequiredId,
} from 'mongodb';

import { BaseWrapper } from './BaseWrapper';

export default class MongoDriverWrapper<
  T extends Document = Document,
> extends BaseWrapper<T> {
  async db(): Promise<Collection<T>> {
    if (!globalThis._database) {
      if (!globalThis._connectionPromise) {
        if (process.env.NEXT_RUNTIME !== 'edge') {
          global._connectionPromise = new Promise<MongoClient>(resolve => {
            import('mongodb').then(async ({ MongoClient }) => {
              const client = await MongoClient.connect(
                `${this.options.connectionString}?retryWrites=true&w=majority`,
                {
                  socketTimeoutMS: 20000,
                  maxIdleTimeMS: 10000,
                  serverSelectionTimeoutMS: 10000,
                },
              );

              resolve(client);
            });
          });
        } else {
          throw new Error(
            'MongoDriverWrapper is not supported in edge runtime',
          );
        }
      }

      globalThis._database = await globalThis._connectionPromise;
    }

    return globalThis._database.db(this.options.collection);
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
    projection?: Document,
  ): Promise<R | null> {
    return (await this.db())
      .findOne<R>(this.sto(filter), { projection })
      .then(result => this.ots(result));
  }

  public async find<R extends Document = T>(
    filter: Filter<T> = {},
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): Promise<R[]> {
    const cursor = (await this.db()).find<R>(this.sto(filter), options);
    const result = await cursor.toArray();

    await cursor.close();
    return this.ots(result);
  }

  public async insertOne(
    document: OptionalUnlessRequiredId<T>,
  ): Promise<{ insertedId: InferIdType<T> }> {
    return (await this.db())
      .insertOne(this.sto(document))
      .then(async result => {
        await this.onMutation('insertOne');
        return this.ots(result);
      });
  }

  public async insertMany(
    documents: OptionalUnlessRequiredId<T>[],
  ): Promise<{ insertedIds: InferIdType<T>[] }> {
    return (await this.db())
      .insertMany(this.sto(documents))
      .then(({ insertedIds }) => ({ insertedIds: Object.values(insertedIds) }))
      .then(async result => {
        await this.onMutation('insertMany');
        return this.ots(result);
      });
  }

  public async updateOne(
    filter: Filter<T>,
    update: object,
    upsert: boolean = false,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return (await this.db())
      .updateOne(this.sto(filter), this.sto(update), {
        upsert,
      })
      .then(async result => {
        await this.onMutation('updateOne');
        return this.ots(result);
      });
  }

  public async updateMany(
    filter: Filter<T>,
    update: object,
    upsert: boolean = false,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return (await this.db())
      .updateMany(this.sto(filter), this.sto(update), { upsert })
      .then(async result => {
        await this.onMutation('updateMany');
        return this.ots(result);
      });
  }

  public async distinct<R = string>(field: string): Promise<R[]> {
    return (await this.db())
      .distinct(field)
      .then(result => this.ots(result) as R[]);
  }

  public async deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }> {
    return (await this.db()).deleteOne(this.sto(filter)).then(async result => {
      await this.onMutation('deleteOne');
      return this.ots(result);
    });
  }

  public async deleteMany(
    filter: Filter<T>,
  ): Promise<{ deletedCount: number }> {
    return (await this.db()).deleteMany(this.sto(filter)).then(async result => {
      await this.onMutation('deleteMany');
      return this.ots(result);
    });
  }

  public async aggregate<R extends Document = Document>(
    pipeline: Document[],
  ): Promise<R[]> {
    const cursor = (await this.db()).aggregate<R>(this.sto(pipeline));
    const result = await cursor.toArray();

    await cursor.close();
    return this.ots(result);
  }

  public async *cursor<R extends Document = Document>(
    pipeline: Document[],
  ): AsyncGenerator<R> {
    const cursor = (await this.db()).aggregate<R>(this.sto(pipeline));

    for await (const doc of cursor) {
      yield this.ots(doc);
    }

    await cursor.close();
  }

  public async *findCursor<R extends Document = T>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): AsyncGenerator<R> {
    const cursor = (await this.db()).find<R>(this.sto(filter), options);
    for await (const doc of cursor) {
      yield this.ots(doc);
    }
    await cursor.close();
  }
}
