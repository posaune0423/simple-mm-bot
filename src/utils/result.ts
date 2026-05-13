import { err, ok, ResultAsync } from "neverthrow";
import type { Result } from "neverthrow";

export function tryCatch<T, E>(fn: () => T, mapError: (error: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (error) {
    return err(mapError(error));
  }
}

export function tryCatchAsync<T, E>(
  promise: Promise<T>,
  mapError: (error: unknown) => E,
): ResultAsync<T, E> {
  return ResultAsync.fromPromise(promise, mapError);
}

export function fromResult<T, E>(result: Result<T, E>): ResultAsync<T, E> {
  return ResultAsync.fromSafePromise(Promise.resolve(result)).andThen((value) => value);
}

export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const okValues: T[] = [];

  for (const result of results) {
    if (result.isErr()) {
      return err(result.error);
    }
    okValues.push(result.value);
  }

  return ok(okValues);
}

export function sequence<T, E>(results: Result<T, E>[]): Result<T[], E> {
  return combine(results);
}

export function combineProperties<T extends Record<string, unknown>, E>(obj: {
  [K in keyof T]: Result<T[K], E>;
}): Result<T, E> {
  const keys = Object.keys(obj) as Array<keyof T>;
  const values = {} as T;

  for (const key of keys) {
    const result = obj[key];
    if (result.isErr()) {
      return err(result.error);
    }
    values[key] = result.value;
  }

  return ok(values);
}
