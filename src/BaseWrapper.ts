import type {
  Document,
  Filter,
  FindOptions,
  InferIdType,
  OptionalUnlessRequiredId,
} from 'mongodb';

import { objectIdToString, stringToObjectId } from './helpers';

// bson ESM TopLevelAwait doesn't work in server actions
// workaround is to force cjs version with require
// https://github.com/vercel/next.js/issues/54282
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ObjectId } = require('bson');

export interface Options {
  collection: string;
  database: string;
  dataSource: string;
  apiKey: string;
  apiUrl: string;
  connectionString?: string;
  debug?: boolean;
  useMongoDbDriver?: boolean;
}

export abstract class BaseWrapper<T extends Document = Document> {
  protected options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  abstract findOne<R extends Document = T>(
    filter: Filter<T>,
    projection?: FindOptions<T>['projection'],
  ): Promise<R | null>;

  abstract find<R extends Document = T>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): Promise<R[]>;

  abstract insertOne(
    document: OptionalUnlessRequiredId<T>,
  ): Promise<{ insertedId: InferIdType<T> }>;

  abstract insertMany(
    documents: OptionalUnlessRequiredId<T>[],
  ): Promise<{ insertedIds: InferIdType<T>[] }>;

  abstract updateOne(
    filter: Filter<T>,
    update: object,
    upsert: boolean,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  abstract updateMany(
    filter: Filter<T>,
    update: object,
    upsert: boolean,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  abstract distinct<R = string>(field: string): Promise<R[]>;

  abstract deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }>;

  abstract deleteMany(filter: Filter<T>): Promise<{ deletedCount: number }>;

  abstract aggregate<R extends Document = Document>(
    pipeline: Document[],
  ): Promise<R[]>;

  abstract cursor<R extends Document = Document>(
    pipeline: Document[],
  ): AsyncGenerator<R>;

  abstract findCursor<R extends Document = Document>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): AsyncGenerator<R>;

  public async findById<R extends Document = T>(id: string): Promise<R | null> {
    return this.findOne({ _id: new ObjectId(id) } as Filter<T>);
  }

  protected ots<T>(obj: T): T {
    return objectIdToString(obj);
  }

  protected sto<T>(obj: T): T {
    return stringToObjectId(obj);
  }
}
