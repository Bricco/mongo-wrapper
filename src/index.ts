import type { ClientSession, Document } from 'mongodb';

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

type Db<T extends Models> = {
  <K extends keyof T>(collection: K): MongoWrapper<T[K]>;
  transaction: (fn: (db: Db<T>) => Promise<void>) => Promise<void>;
};

const DbFactory = <T extends Models>(
  options: Omit<Options, 'collection'>,
  _session?: ClientSession,
): Db<T> => {
  function db<K extends keyof T>(collection: K): MongoWrapper<T[K]> {
    const ctx: Options = {
      ...options,
      collection: collection as string,
    };
    return new MongoWrapper<T[K]>(ctx, _session);
  }

  db.transaction = async (fn: (db: Db<T>) => Promise<void>) => {
    if (_session) {
      throw new Error('Nested transactions are not supported');
    }

    const session = await options.client.startSession();
    await session.withTransaction(async () => {
      await fn(DbFactory<T>(options, session));
    });
    await session.endSession();
  };

  return db;
};

const createDb = <T extends Models>(
  options: Omit<Options, 'collection'>,
): Db<T> => DbFactory<T>(options);

export default createDb;
