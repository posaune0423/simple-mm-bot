import { stringifyError } from "./errors.ts";

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
  if (typeof error === "object" && error !== null) {
    const errorLike = error as ErrorLike;
    if (errorLike.name === "BulkTimeoutError") {
      return true;
    }
    const status = toHttpStatus(errorLike);
    if (status === 408) {
      return true;
    }
  }

  const message = stringifyError(error);
  return message.includes("HTTP error 408") || message.includes("HTTP request timed out");
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

  const directStatus = maybeStatus(errorLike.status);
  if (directStatus !== undefined) {
    return directStatus;
  }

  if (
    errorLike.response === undefined ||
    errorLike.response === null ||
    typeof errorLike.response !== "object"
  ) {
    return undefined;
  }

  const responseStatus = maybeStatus((errorLike.response as { status?: unknown }).status);
  return responseStatus;
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
