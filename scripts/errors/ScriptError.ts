export type ScriptErrorContext = Readonly<Record<string, string | number | boolean | null>>;
type ScriptErrorOptions = { context?: ScriptErrorContext; cause?: unknown };

export class ScriptError extends Error {
  readonly context: ScriptErrorContext;

  constructor(
    readonly code: string,
    message: string,
    options: ScriptErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ScriptError";
    this.context = options.context ?? {};
  }
}

export function isScriptError(error: unknown): error is ScriptError {
  return error instanceof ScriptError;
}

export function formatScriptError(error: ScriptError): string {
  const context = Object.entries(error.context)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return context.length > 0
    ? `[${error.code}] ${error.message} ${context}`
    : `[${error.code}] ${error.message}`;
}
