import { MongoClient } from 'mongodb';

export type QueryOptions = {
  cache?: boolean;
};

export type UpdateOptions = {
  skipSetOnUpdate?: boolean;
  upsert?: boolean;
};

export type CacheFunction = <T>(
  fn: () => Promise<T>,
  args: string[],
  options?: { revalidate?: number | false; tags?: string[] },
) => () => Promise<T>;

export interface Options {
  cache?: CacheFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError?: (error: Error, metadata: Record<string, any>) => void;
  client: MongoClient;
  collection: string;
  database: string;
  debug?: boolean;
  onMutation?: (props: {
    action: string;
    collection: string;
  }) => void | Promise<void>;
  setOnInsert?: (
    collection: string,
    update: object,
  ) => Promise<object | void | null>;
  setOnUpdate?: (
    collection: string,
    update: object,
  ) => Promise<object | void | null>;
  shouldRevalidate?: (tag: string) => boolean | Promise<boolean>;
}
