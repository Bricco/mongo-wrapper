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

export interface RetryOptions {
  /** Maximum number of retry attempts for connection errors (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 10000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
}

export interface Options {
  cache?: CacheFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError?: (error: Error, metadata: Record<string, any>) => void;
  client: MongoClient;
  collection: string;
  database: string;
  debug?: boolean;
  disableTransactions?: boolean;
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
  /** Configuration for retry behavior on connection errors */
  retry?: RetryOptions;
}
