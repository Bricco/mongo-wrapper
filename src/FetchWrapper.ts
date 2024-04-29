import type {
  Document,
  Filter,
  FindOptions,
  InferIdType,
  OptionalUnlessRequiredId,
} from 'mongodb';

import { BaseWrapper, QueryOptions, UpdateOptions } from './BaseWrapper';
import { debug, error } from './helpers';

// bson ESM TopLevelAwait doesn't work in server actions
// workaround is to force cjs version with require
// https://github.com/vercel/next.js/issues/54282
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EJSON } = require('bson');

const mutationMethods = [
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
];

export class FetchWrapper<T extends Document = Document>
  extends BaseWrapper<T>
  implements BaseWrapper<T>
{
  private async getCacheField(
    name: string,
    cacheOverride: boolean,
  ): Promise<string> {
    if (mutationMethods.includes(name)) {
      return 'no-store';
    }

    if (cacheOverride === false) {
      return 'no-cache';
    }

    if (this.options?.shouldRevalidate) {
      const revalidate = await this.options.shouldRevalidate(
        this.options.collection,
      );
      return revalidate ? 'no-cache' : 'force-cache';
    }

    return 'force-cache';
  }

  private async reqest<Resp>(
    name: string,
    { cache: cacheOverride = true, ...parameters }: Document,
  ): Promise<Resp> {
    const ts = Date.now();
    return fetch(`${this.options.apiUrl}/action/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/ejson',
        Accept: 'application/ejson',
        'access-control-request-headers': '*',
        'api-key': this.options.apiKey,
      },
      body: EJSON.stringify({
        dataSource: this.options.dataSource,
        database: this.options.database,
        collection: this.options.collection,
        ...this.sto(parameters),
      }),
      next: {
        tags: [this.options.collection],
      },
      cache: await this.getCacheField(name, cacheOverride),
    } as RequestInit)
      .then(response => Promise.all([response.status, response.json()]))

      .then(async ([status, data]) => {
        if (status < 200 || status >= 300) {
          if (this.options.debug) {
            error(
              'FetchWrapper.ts',
              `${this.options.collection}.${name}`,
              parameters,
              Date.now() - ts,
            );
          }
          throw new Error(
            `${status} (${data.error_code}): ${data.error || data}`,
          );
        }

        if (this.options.debug) {
          debug(
            'FetchWrapper.ts',
            `${this.options.collection}.${name}`,
            parameters,
            Date.now() - ts,
          );
        }

        if (mutationMethods.includes(name) && this.options?.onMutation) {
          await this.options.onMutation({
            collection: this.options.collection,
            action: name,
          });
        }

        return this.ots(EJSON.deserialize(data));
      });
  }

  public async findOne<R extends Document = T>(
    filter: Filter<T> = {},
    options: { projection?: FindOptions<T>['projection'] } & QueryOptions = {},
  ): Promise<R | null> {
    return this.reqest<{ document: R | null }>('findOne', {
      filter,
      ...options,
    }).then(resp => resp.document);
  }

  public async find<R extends Document = T>(
    filter: Filter<T> = {},
    options: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'> &
      QueryOptions = {},
  ): Promise<R[]> {
    return this.reqest<{ documents: R[] }>('find', { filter, ...options }).then(
      resp => resp.documents,
    );
  }

  public async insertOne(
    document: OptionalUnlessRequiredId<T>,
  ): Promise<{ insertedId: InferIdType<T> }> {
    return this.reqest('insertOne', { document });
  }

  public async insertMany(
    documents: OptionalUnlessRequiredId<T>[],
  ): Promise<{ insertedIds: InferIdType<T>[] }> {
    return this.reqest('insertMany', { documents });
  }

  public async updateOne(
    filter: Filter<T>,
    update: object,
    { ref, upsert = false }: UpdateOptions = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return this.reqest('updateOne', {
      filter,
      update: this.addReferenceToUpdate(update, ref),
      upsert,
    });
  }

  public async updateMany(
    filter: Filter<T>,
    update: object,
    { ref, upsert = false }: UpdateOptions = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return this.reqest('updateMany', {
      filter,
      update: this.addReferenceToUpdate(update, ref),
      upsert,
    });
  }

  public async distinct<R = string>(field: string): Promise<R[]> {
    return this.aggregate([
      {
        $group: {
          _id: `$${field}`,
        },
      },
    ]).then(resp => this.ots(resp.map((r: Document) => r._id)));
  }

  public async deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }> {
    return this.reqest('deleteOne', { filter });
  }

  public async deleteMany(
    filter: Filter<T>,
  ): Promise<{ deletedCount: number }> {
    return this.reqest('deleteMany', { filter });
  }

  public async aggregate<R extends Document = Document>(
    pipeline: Document[],
    options: QueryOptions = {},
  ): Promise<R[]> {
    return this.reqest<{ documents: R[] }>('aggregate', {
      pipeline,
      ...options,
    }).then(resp => resp.documents);
  }

  cursor<R extends Document = Document>(): AsyncGenerator<R> {
    throw new Error('Cursor is not working when using fetch');
  }

  findCursor<R extends Document = T>(): AsyncGenerator<R> {
    throw new Error('Cursor is not working when using fetch');
  }
}
