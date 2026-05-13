export type DomainErrorContext = Readonly<Record<string, string | number | boolean | null>>;

export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly context: DomainErrorContext;

  protected constructor(
    message: string,
    options: {
      context?: DomainErrorContext;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.context = options.context ?? {};
  }

  static is(error: unknown): error is DomainError {
    return isDomainError(error);
  }

  static format(error: DomainError): string {
    return formatDomainError(error);
  }
}

export class InvalidPriceError extends DomainError {
  readonly code = "domain.invalid_price";

  constructor(field: string, value: number, reason: string, options: { cause?: unknown } = {}) {
    super(reason, {
      cause: options.cause,
      context: { field, value, reason },
    });
  }
}

export class InvalidQuantityError extends DomainError {
  readonly code = "domain.invalid_quantity";

  constructor(field: string, value: number, reason: string, options: { cause?: unknown } = {}) {
    super(reason, {
      cause: options.cause,
      context: { field, value, reason },
    });
  }
}

export class InvalidBasisPointsError extends DomainError {
  readonly code = "domain.invalid_basis_points";

  constructor(field: string, value: number, reason: string, options: { cause?: unknown } = {}) {
    super(reason, {
      cause: options.cause,
      context: { field, value, reason },
    });
  }
}

export class InvalidQuoteError extends DomainError {
  readonly code = "domain.invalid_quote";

  constructor(reason: string, options: { context?: DomainErrorContext; cause?: unknown } = {}) {
    super(reason, options);
  }
}

export class InvalidPositionError extends DomainError {
  readonly code = "domain.invalid_position";

  constructor(reason: string, options: { context?: DomainErrorContext; cause?: unknown } = {}) {
    super(reason, options);
  }
}

export class InvalidOrderIntentError extends DomainError {
  readonly code = "domain.invalid_order_intent";

  constructor(reason: string, options: { context?: DomainErrorContext; cause?: unknown } = {}) {
    super(reason, options);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function formatDomainError(error: DomainError): string {
  const context = Object.entries(error.context)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return context.length === 0
    ? `[${error.code}] ${error.message}`
    : `[${error.code}] ${error.message} ${context}`;
}
