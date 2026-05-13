import { match, P } from "ts-pattern";
import { RecoverableVenueError } from "../../domain/ports/RecoverableVenueError.ts";
import { stringifyError } from "../../utils/errors.ts";

type ErrorLike = {
  name?: unknown;
  status?: unknown;
  message?: unknown;
  response?: unknown;
};

interface RetryOptions {
  attempts: number;
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, attempts: number) => void;
}

export function isTransientBulkError(error: unknown): boolean {
  const structuredTransient = match(error)
    .with(P.when(isErrorLike), (errorLike) =>
      match({ name: errorLike.name, status: toHttpStatus(errorLike) })
        .with({ name: "BulkTimeoutError" }, () => true)
        .with({ status: 408 }, () => true)
        .otherwise(() => false),
    )
    .otherwise(() => false);

  if (structuredTransient) {
    return true;
  }

  const message = stringifyError(error);
  return message.includes("HTTP error 408") || message.includes("HTTP request timed out");
}

export function toRecoverableBulkError(error: unknown, operation: string): RecoverableVenueError {
  return new RecoverableVenueError(stringifyError(error), {
    venue: "bulk",
    operation,
    cause: error,
  });
}

export function throwRecoverableBulkError(error: unknown, operation: string): never {
  if (isTransientBulkError(error)) {
    throw toRecoverableBulkError(error, operation);
  }
  throw error;
}

function isErrorLike(error: unknown): error is ErrorLike {
  return typeof error === "object" && error !== null;
}

function toHttpStatus(errorLike: ErrorLike): number | undefined {
  const maybeStatus = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) ? parsed : undefined;
    }
    return undefined;
  };

  return match(maybeStatus(errorLike.status))
    .with(
      P.when((status): status is number => status !== undefined),
      (status) => status,
    )
    .otherwise(() =>
      match(errorLike.response)
        .with(P.when(isErrorLike), (response) => maybeStatus(response.status))
        .otherwise(() => undefined),
    );
}

export async function retryTransientBulk<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const sleep = options.sleep ?? Bun.sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientBulkError(error) || attempt === attempts) {
        throw error;
      }
      options.onRetry?.(error, attempt, attempts);
      await sleep(options.delayMs);
    }
  }

  throw lastError;
}
