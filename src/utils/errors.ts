export interface AppError {
  code: string;
  message: string;
  cause?: unknown;
}

export function createAppError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
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

export function formatAppError(error: AppError): string {
  const detail = error.cause === undefined ? "" : `: ${getErrorMessage(error.cause)}`;
  return `[${error.code}] ${error.message}${detail}`;
}
