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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref?: any;
};

export interface Options {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getChangeReference(collection: string, update: object): Promise<any>;
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

  protected async addReferenceToUpdate(
    update: object,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ref: any,
  ): Promise<object> {
    let _ref = ref;

    if (!ref && this.options.getChangeReference) {
      _ref = await this.options.getChangeReference(
        this.options.collection,
        update,
      );
    }

    if (_ref) {
      const fieldName = this.options.changeReferenceFieldName || '_ref';
      update['$set'] ||= {};
      update['$set'][fieldName] = _ref;
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
