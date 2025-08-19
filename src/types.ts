export type QueryOptions = {
  cache?: boolean;
};

export type UpdateOptions = {
  upsert?: boolean;
  skipSetOnUpdate?: boolean;
};

export type CacheFunction = <T>(
  fn: () => Promise<T>,
  args: string[],
  options?: { revalidate?: number | false; tags?: string[] },
) => () => Promise<T>;

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
  connectionString: string;
  debug?: boolean;
  cache?: CacheFunction;
  onMutation?: (props: {
    collection: string;
    action: string;
  }) => void | Promise<void>;
  shouldRevalidate?: (tag: string) => boolean | Promise<boolean>;
}
