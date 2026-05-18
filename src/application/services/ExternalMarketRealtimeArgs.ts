import type { ExternalMarketRealtimeViewMode } from "./ExternalMarketRealtimeView.ts";

export type ExternalMarketRealtimeArgs = Readonly<{
  durationMs: number | undefined;
  refreshMs: number;
  statsWindowMs: number;
  viewMode: ExternalMarketRealtimeViewMode;
  watch: boolean;
}>;

export type ExternalMarketRealtimeArgOptions = Readonly<{
  isTty: boolean;
}>;

export function parseExternalMarketRealtimeArgs(
  argv: readonly string[],
  options: ExternalMarketRealtimeArgOptions,
): ExternalMarketRealtimeArgs {
  const viewMode = parseViewMode(argv, options);
  const durationArg = parseOptionalIntegerArg(argv, "--durationMs");
  const watch =
    argv.includes("--watch") ||
    durationArg === 0 ||
    (viewMode === "tui" && durationArg === undefined);

  return {
    durationMs: watch ? undefined : (durationArg ?? 30_000),
    refreshMs: parseIntegerArg(argv, "--refreshMs", 1_000),
    statsWindowMs: parseIntegerArg(argv, "--statsWindowMs", 5_000),
    viewMode,
    watch,
  };
}

function parseViewMode(
  argv: readonly string[],
  options: ExternalMarketRealtimeArgOptions,
): ExternalMarketRealtimeViewMode {
  const index = argv.indexOf("--view");
  if (index === -1) {
    return options.isTty ? "tui" : "log";
  }
  const value = argv[index + 1];
  if (value !== "log" && value !== "tui") {
    throw new Error("--view must be log or tui");
  }
  return value;
}

function parseIntegerArg(argv: readonly string[], name: string, fallback: number): number {
  const parsed = parseOptionalIntegerArg(argv, name);
  if (parsed === undefined) {
    return fallback;
  }
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalIntegerArg(argv: readonly string[], name: string): number | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
