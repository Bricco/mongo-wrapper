import type {
  Document,
  Filter,
  FindOptions,
  InferIdType,
  OptionalUnlessRequiredId,
} from 'mongodb';

import { objectIdToString, stringToObjectId } from './helpers';

export type QueryOptions = {
  cache?: boolean;
};

export type UpdateOptions = {
  upsert?: boolean;
  skipSetOnUpdate?: boolean;
};

export interface Options {
  setOnUpdate?: (
    collection: string,
    update: object,
  ) => Promise<object | void | null>;
  setOnInsert?: (
    collection: string,
    update: object,
  ) => Promise<object | void | null>;
  collection: string;
  database: string;
  dataSource: string;
  apiKey: string;
  apiUrl: string;
  connectionString?: string;
  debug?: boolean;
  useMongoDbDriver?: boolean;
  onMutation?: (props: {
    collection: string;
    action: string;
  }) => void | Promise<void>;
  shouldRevalidate?: (tag: string) => boolean | Promise<boolean>;
  changeReferenceFieldName?: string;
}

export abstract class BaseWrapper<T extends Document = Document> {
  protected options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  protected async onInsert<T extends object>(document: T): Promise<T> {
    const onInsert = await this.options.setOnInsert?.(
      this.options.collection,
      document,
    );

    if (onInsert) {
      return { ...onInsert, ...document };
    }

    return document;
  }

  protected async onUpdate<T extends object>(
    update: T,
    skipSetOnUpdate: boolean,
  ): Promise<T> {
    if (skipSetOnUpdate) {
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
      update['$set'] = { ...onUpdate, ...update['$set'] };
    }

    if (onInsert) {
      const entries = Object.entries(onInsert).filter(
        ([key]) => !update?.['$set']?.[key],
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

  abstract findOne<R extends Document = T>(
    filter: Filter<T>,
    options?: { projection?: FindOptions<T>['projection'] } & QueryOptions,
  ): Promise<R | null>;

  abstract find<R extends Document = T>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'> &
      QueryOptions,
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
    options: UpdateOptions,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  abstract updateMany(
    filter: Filter<T>,
    update: object,
    options: UpdateOptions,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  abstract distinct<R = string>(field: string): Promise<R[]>;

  abstract deleteOne(filter: Filter<T>): Promise<{ deletedCount: number }>;

  abstract deleteMany(filter: Filter<T>): Promise<{ deletedCount: number }>;

  abstract aggregate<R extends Document = Document>(
    pipeline: Document[],
    options?: QueryOptions,
  ): Promise<R[]>;

  abstract cursor<R extends Document = Document>(
    pipeline: Document[],
  ): AsyncGenerator<R>;

  abstract findCursor<R extends Document = T>(
    filter: Filter<T>,
    options?: Pick<FindOptions<T>, 'projection' | 'sort' | 'limit' | 'skip'>,
  ): AsyncGenerator<R>;

  public async findById<R extends Document = T>(id: string): Promise<R | null> {
    return this.findOne({ _id: id } as Filter<T>);
  }

  protected ots<T>(obj: T): T {
    return objectIdToString(obj);
  }

  protected sto<T>(obj: T): T {
    return stringToObjectId(obj);
  }
}
