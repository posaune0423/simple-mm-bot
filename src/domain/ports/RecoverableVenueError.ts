type RecoverableVenueErrorContext = Readonly<Record<string, string | number | boolean | null>>;

export class RecoverableVenueError extends Error {
  readonly code = "venue.recoverable";
  readonly venue: string;
  readonly operation: string;
  readonly context: RecoverableVenueErrorContext;

  constructor(
    message: string,
    options: {
      venue: string;
      operation: string;
      context?: RecoverableVenueErrorContext;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "RecoverableVenueError";
    this.venue = options.venue;
    this.operation = options.operation;
    this.context = options.context ?? {};
  }
}

export function isRecoverableVenueError(error: unknown): error is RecoverableVenueError {
  return error instanceof RecoverableVenueError;
}
