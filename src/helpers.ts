import type { Sort } from 'mongodb';

// bson ESM TopLevelAwait doesn't work in server actions
// workaround is to force cjs version with require
// https://github.com/vercel/next.js/issues/54282
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ObjectId } = require('bson');

export function getSort(sort?: string): Sort | undefined {
  if (!sort) {
    return undefined;
  }

  const desc = sort.startsWith('-');
  const field = sort.replace('-', '').replace('_', '.');

  return { [field]: desc ? -1 : 1 };
}

// Console colors
const cc = {
  yellow: (text?: string): string | undefined =>
    text ? `\x1b[33m${text}\x1b[0m` : undefined,
  blue: (text?: string): string | undefined =>
    text ? `\x1b[34m${text}\x1b[0m` : undefined,
  gray: (text?: string): string | undefined =>
    text ? `\x1b[90m${text}\x1b[0m` : undefined,
  green: (text?: string): string | undefined =>
    text ? `\x1b[32m${text}\x1b[0m` : undefined,
  red: (text?: string): string | undefined =>
    text ? `\x1b[31m${text}\x1b[0m` : undefined,
};

// This function is used to debug log. Only exists in development mode.
export const debug = (
  name?: string,
  method?: string,
  parameters?: object,
  ms?: number,
): void => {
  // eslint-disable-next-line no-console
  console.debug(
    `${cc.yellow(name)} ` +
      `${ms !== undefined && ms < 10 ? cc.blue(method) : cc.green(method)} ` +
      `${ms !== undefined && cc.gray(`(${ms}ms) `)}${JSON.stringify(
        parameters,
      )}`,
  );
};

// This function is used to error log. Only exists in development mode.
export const error = (
  name?: string,
  method?: string,
  parameters?: object,
  ms?: number,
): void => {
  // eslint-disable-next-line no-console
  console.error(
    `${cc.yellow(name)} ` +
      `${cc.red(method)} ` +
      `${ms !== undefined && cc.gray(`(${ms}ms) `)}${JSON.stringify(
        parameters,
      )}`,
  );
};

export const isPlainObject = (
  obj: unknown,
  includeArrays = false,
): obj is object =>
  obj != null &&
  typeof obj === 'object' &&
  ((includeArrays && Array.isArray(obj)) ||
    (!Array.isArray(obj) && Object.entries(obj).length > 0));

export const isObjectId = (obj: unknown): obj is typeof ObjectId =>
  ObjectId.is(obj);

export const objectIdToString = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(value =>
      isObjectId(value)
        ? value.toString()
        : isPlainObject(value, true)
          ? objectIdToString(value)
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
              ? objectIdToString(value)
              : value,
        ]),
      ) as T)
    : obj; // Date or other type of object
};

export const stringToObjectId = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(value =>
      typeof value === 'string' && ObjectId.isValid(value)
        ? new ObjectId(value)
        : isPlainObject(value, true)
          ? stringToObjectId(value)
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
              ? stringToObjectId(value)
              : value,
        ]),
      ) as T)
    : obj; // Date or other type of object
};
