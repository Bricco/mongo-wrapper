import { type Document } from 'mongodb';

import { Options } from './BaseWrapper';
import MongoDriverWrapper from './MongoDriverWrapper';

export { isObjectId, objectIdToString, stringToObjectId } from './helpers';

type Models = {
  [collection: string]: Document;
};

export type FacetResponse<T> = {
  data: T[];
  metadata: { count: number; total: number; limit: number; page: number };
};

const createDb =
  <T extends Models>(options: Omit<Options, 'collection'>) =>
  <K extends keyof T>(collection: K) => {
    const ctx: Options = { ...options, collection: collection as string };
    return new MongoDriverWrapper<T[K]>(ctx);
  };

export default createDb;
