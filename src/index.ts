import { type Document } from 'mongodb';

import { Options } from './BaseWrapper';
import { FetchWrapper } from './FetchWrapper';
import MongoDriverWrapper from './MongoDriverWrapper';

type Models = {
  [collection: string]: Document;
};

export type FacetResponse<T> = {
  data: T[];
  metadata: { count: number; total: number; limit: number; page: number };
};

const createDb =
  <T extends Models>(options: Omit<Options, 'collection'>) =>
  <K extends keyof T>(
    collection: K,
    useMongoDbDriver = options?.useMongoDbDriver ?? false,
  ) => {
    const ctx: Options = { ...options, collection: collection as string };

    const _wrapper = useMongoDbDriver ? MongoDriverWrapper : FetchWrapper;

    return new _wrapper<T[K]>(ctx);
  };

export default createDb;
