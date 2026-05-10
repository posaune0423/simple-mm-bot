type ErrorLike = {
  name?: unknown;
  status?: unknown;
  message?: unknown;
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
    if (errorLike.status === 408 || errorLike.status === "408") {
      return true;
    }
  }

  const message = String(error);
  return message.includes("HTTP error 408") || message.includes("HTTP request timed out");
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
