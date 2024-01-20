import type {
  Document,
  Filter,
  FindOptions,
  InferIdType,
  OptionalUnlessRequiredId,
} from 'mongodb';

import { BaseWrapper } from './BaseWrapper';
import { debug, error } from './helpers';

// bson ESM TopLevelAwait doesn't work in server actions
// workaround is to force cjs version with require
// https://github.com/vercel/next.js/issues/54282
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EJSON } = require('bson');

export class FetchWrapper<
  T extends Document = Document,
> extends BaseWrapper<T> {
  private async reqest<Resp>(name: string, parameters: object): Promise<Resp> {
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
      cache: 'force-cache',
    } as RequestInit)
      .then(response => Promise.all([response.status, response.json()]))

      .then(([status, data]) => {
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

        return this.ots(EJSON.deserialize(data));
      });
  }

  public async findOne<R extends Document = T>(
    filter: Filter<T> = {},
    projection?: FindOptions<T>['projection'],
  ): Promise<R | null> {
    return this.reqest<{ document: R | null }>('findOne', {
      filter,
      projection,
    }).then(resp => resp.document);
  }

  public async find<R extends Document = T>(
    filter: Filter<T> = {},
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
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
    upsert: boolean = false,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return this.reqest('updateOne', { filter, update, upsert });
  }

  public async updateMany(
    filter: Filter<T>,
    update: object,
    upsert: boolean = false,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    return this.reqest('updateMany', { filter, update, upsert });
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
  ): Promise<R[]> {
    return this.reqest<{ documents: R[] }>('aggregate', { pipeline }).then(
      resp => resp.documents,
    );
  }
}
