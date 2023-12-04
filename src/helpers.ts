import type { Sort } from 'mongodb';

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
