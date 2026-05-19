type DomainErrorContext = Readonly<Record<string, string | number | boolean | null>>;

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

export class EmptyQuoteError extends InvalidQuoteError {
  constructor(options: { cause?: unknown } = {}) {
    super("quote must contain at least one bid or ask leg", options);
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

type DomainErrorOptions = {
  context?: DomainErrorContext;
  cause?: unknown;
};

export abstract class QuoteModelError extends DomainError {
  protected constructor(
    readonly model: string,
    message: string,
    options: DomainErrorOptions = {},
  ) {
    super(message, {
      cause: options.cause,
      context: { ...options.context, model },
    });
  }
}

export class InvalidQuoteModelInputError extends QuoteModelError {
  readonly code = "quote_model.invalid_input";

  constructor(model: string, message: string, options: DomainErrorOptions = {}) {
    super(model, message, options);
  }
}

export class InvalidModelQuoteError extends QuoteModelError {
  readonly code = "quote_model.invalid_model_quote";

  constructor(model: string, message: string, options: DomainErrorOptions = {}) {
    super(model, message, options);
  }
}

export class InvalidQuoteEngineInputError extends DomainError {
  readonly code = "quote_engine.invalid_input";

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, options);
  }
}

export type QuoteUnavailableReason = "external_fair_unavailable";

export class QuoteUnavailableError extends DomainError {
  readonly code = "quote_engine.quote_unavailable";

  constructor(
    message: string,
    readonly reasonTag: QuoteUnavailableReason,
    options: DomainErrorOptions = {},
  ) {
    super(message, {
      ...options,
      context: { ...options.context, reason: reasonTag },
    });
  }
}

export class QuoteModelFailedError extends DomainError {
  readonly code = "quote_engine.quote_model_failed";

  constructor(
    readonly model: string,
    cause: QuoteModelError,
  ) {
    super(cause.message, {
      cause,
      context: { model },
    });
  }
}

export type QuoteEngineError = DomainError;

abstract class StrategyErrorBase extends DomainError {
  protected constructor(
    readonly strategy: string,
    message: string,
    options: DomainErrorOptions = {},
  ) {
    super(message, {
      cause: options.cause,
      context: { ...options.context, strategy },
    });
  }
}

export class StrategyQuoteFailedError extends StrategyErrorBase {
  readonly code = "strategy.quote_failed";

  constructor(strategy: string, message: string, options: DomainErrorOptions = {}) {
    super(strategy, message, options);
  }
}

class StrategyInputInvalidError extends StrategyErrorBase {
  readonly code = "strategy.input_invalid";

  constructor(strategy: string, message: string, options: DomainErrorOptions = {}) {
    super(strategy, message, options);
  }
}

export type StrategyError = StrategyQuoteFailedError | StrategyInputInvalidError;

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
