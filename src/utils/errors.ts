export interface AppError {
  code: string;
  message: string;
  cause?: unknown;
}

export interface ErrorDescription {
  code?: string;
  title: string;
  reason: string;
  cause?: string;
  details: string;
  stack?: string;
}

export function createAppError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause };
}

export function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || "Unknown error";
    return error.name && error.name !== "Error" ? `${error.name}: ${message}` : message;
  }

  if (typeof error === "string") {
    return error;
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

export function formatAppError(error: AppError): string {
  const detail = error.cause === undefined ? "" : `: ${stringifyError(error.cause)}`;
  return `[${error.code}] ${error.message}${detail}`;
}

export function formatUnknownError(error: unknown): string {
  return describeError(error).details;
}

export function describeError(error: unknown): ErrorDescription {
  if (isAppError(error)) {
    return {
      code: error.code,
      title: error.code,
      reason: error.message,
      cause: error.cause === undefined ? undefined : stringifyError(error.cause),
      details: formatAppError(error),
      stack: error.cause instanceof Error ? error.cause.stack : undefined,
    };
  }

  if (error instanceof Error) {
    const details = stringifyError(error);
    return {
      title: error.name || "Error",
      reason: error.message || details,
      details,
      stack: error.stack,
    };
  }

  const reason = stringifyError(error);
  return {
    title: "Error",
    reason,
    details: reason,
  };
}
