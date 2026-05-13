export interface ErrorDescription {
  code?: string;
  title: string;
  reason: string;
  cause?: string;
  context?: Record<string, unknown>;
  chain?: string[];
  details: string;
  stack?: string;
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || "Unknown error";
    const code = errorCode(error);
    if (code !== undefined) {
      return `[${code}] ${message}`;
    }
    return error.name && error.name !== "Error" ? `${error.name}: ${message}` : message;
  }

  if (typeof error === "string") {
    return error;
  }
  if (error === undefined || typeof error === "symbol" || typeof error === "function") {
    return String(error);
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function getErrorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

export function formatUnknownError(error: unknown): string {
  return describeError(error).details;
}

export function describeError(error: unknown): ErrorDescription {
  if (error instanceof Error) {
    const code = errorCode(error);
    const cause = errorCause(error);
    const reason = error.message || stringifyError(error);
    const details = formatErrorWithCause(error, cause);
    const causeError = cause instanceof Error ? cause : undefined;
    return {
      code,
      title: code ?? error.name,
      reason,
      cause: cause === undefined ? undefined : stringifyError(cause),
      context: errorContext(error),
      chain: errorChain(error),
      details,
      stack: causeError?.stack ?? error.stack,
    };
  }

  const reason = stringifyError(error);
  return {
    title: "Error",
    reason,
    details: reason,
  };
}

function formatErrorWithCause(error: Error, cause: unknown): string {
  const code = errorCode(error);
  const head = code === undefined ? stringifyError(error) : `[${code}] ${error.message}`;
  return cause === undefined ? head : `${head}: ${stringifyError(cause)}`;
}

function errorCode(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorContext(error: Error): Record<string, unknown> | undefined {
  const context = (error as Error & { context?: unknown }).context;
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    return undefined;
  }
  return context as Record<string, unknown>;
}

function errorCause(error: Error): unknown {
  return (error as Error & { cause?: unknown }).cause;
}

function errorChain(error: Error): string[] {
  const chain: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = error;

  while (current instanceof Error) {
    if (seen.has(current)) {
      chain.push("[cycle detected]");
      current = undefined;
      break;
    }
    seen.add(current);
    chain.push(
      current.name && current.name !== "Error"
        ? `${current.name}: ${current.message}`
        : current.message,
    );
    current = errorCause(current);
  }

  if (current !== undefined) {
    chain.push(stringifyError(current));
  }

  return chain;
}
