export type ApplicationErrorContext = Readonly<Record<string, string | number | boolean | null>>;

export abstract class ApplicationError extends Error {
  abstract readonly code: string;
  readonly context: ApplicationErrorContext;

  protected constructor(
    message: string,
    options: { context?: ApplicationErrorContext; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.context = options.context ?? {};
  }

  static is(error: unknown): error is ApplicationError {
    return isApplicationError(error);
  }

  static format(error: ApplicationError): string {
    return formatApplicationError(error);
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}

export function formatApplicationError(error: ApplicationError): string {
  const context = Object.entries(error.context)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return context.length > 0
    ? `[${error.code}] ${error.message} ${context}`
    : `[${error.code}] ${error.message}`;
}
