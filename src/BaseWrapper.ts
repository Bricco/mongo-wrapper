import type {
  Document,
  Filter,
  FindOptions,
  InferIdType,
  OptionalUnlessRequiredId,
} from 'mongodb';

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
  connectionString: string;
}

const isPlainObject = (obj: unknown, includeArrays = false): obj is object =>
  obj != null &&
  typeof obj === 'object' &&
  ((includeArrays && Array.isArray(obj)) ||
    (!Array.isArray(obj) && Object.entries(obj).length > 0));

const isObjectId = (obj: unknown): obj is typeof ObjectId =>
  obj != null && obj instanceof ObjectId;

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

  abstract deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }>;

  abstract deleteMany(filter: Filter<T>): Promise<{ deletedCount: number }>;

  abstract aggregate<R extends Document = Document>(
    pipeline: Document[],
  ): Promise<R[]>;

  public async findById(id: string): Promise<T | null> {
    return this.findOne({ _id: new ObjectId(id) } as Filter<T>);
  }

  protected ots<T>(obj: T): T {
    if (Array.isArray(obj)) {
      return obj.map(value =>
        isObjectId(value)
          ? value.toString()
          : isPlainObject(value, true)
            ? this.ots(value)
            : value,
      ) as T;
    }

    return isPlainObject(obj)
      ? (Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [
            key,
            isObjectId(value)
              ? value.toString()
              : isPlainObject(value, true)
                ? this.ots(value)
                : value,
          ]),
        ) as T)
      : obj; // Date or other type of object
  }

  protected sto<T>(obj: T): T {
    if (Array.isArray(obj)) {
      return obj.map(value =>
        typeof value === 'string' && ObjectId.isValid(value)
          ? new ObjectId(value)
          : isPlainObject(value, true)
            ? this.sto(value)
            : value,
      ) as T;
    }

    return isPlainObject(obj)
      ? (Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [
            key,
            typeof value === 'string' && ObjectId.isValid(value)
              ? new ObjectId(value)
              : isPlainObject(value, true)
                ? this.sto(value)
                : value,
          ]),
        ) as T)
      : obj; // Date or other type of object
  }
}
