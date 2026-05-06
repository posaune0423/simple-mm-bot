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
