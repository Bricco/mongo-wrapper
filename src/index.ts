import type { Document } from 'mongodb';

import MongoWrapper from './MongoWrapper';
import { Options } from './types';

export { isObjectId, objectIdToString, stringToObjectId } from './helpers';

type Models = {
  [collection: string]: Document;
};

export type FacetResponse<T> = {
  data: T[];
  metadata: { count: number; limit: number; page: number; total: number };
};

const createDb =
  <T extends Models>(options: Omit<Options, 'collection'>) =>
  <K extends keyof T>(collection: K) => {
    const ctx: Options = {
      ...options,
      collection: collection as string,
    };
    return new MongoWrapper<T[K]>(ctx);
  };

export default createDb;
