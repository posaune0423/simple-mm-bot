export type DomainError =
  | {
      type: "invalid_market_id";
      value: string;
      reason: string;
    }
  | {
      type: "invalid_price";
      field: string;
      value: number;
      reason: string;
    }
  | {
      type: "invalid_quantity";
      field: string;
      value: number;
      reason: string;
    }
  | {
      type: "invalid_basis_points";
      field: string;
      value: number;
      reason: string;
    }
  | {
      type: "invalid_quote";
      reason: string;
    }
  | {
      type: "invalid_position";
      reason: string;
    }
  | {
      type: "invalid_order_intent";
      reason: string;
    };

const domainErrorTypes = new Set<DomainError["type"]>([
  "invalid_market_id",
  "invalid_price",
  "invalid_quantity",
  "invalid_basis_points",
  "invalid_quote",
  "invalid_position",
  "invalid_order_intent",
]);

export const DomainError = {
  is: isDomainError,
  format: formatDomainError,
};

export function isDomainError(error: unknown): error is DomainError {
  if (typeof error !== "object" || error === null || error instanceof Error) {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !domainErrorTypes.has(candidate.type as never)) {
    return false;
  }

  switch (candidate.type) {
    case "invalid_market_id":
      return typeof candidate.value === "string" && typeof candidate.reason === "string";
    case "invalid_price":
    case "invalid_quantity":
    case "invalid_basis_points":
      return (
        typeof candidate.field === "string" &&
        typeof candidate.value === "number" &&
        typeof candidate.reason === "string"
      );
    case "invalid_quote":
    case "invalid_position":
    case "invalid_order_intent":
      return typeof candidate.reason === "string";
  }
  return false;
}

export function formatDomainError(error: DomainError): string {
  switch (error.type) {
    case "invalid_market_id":
      return `[${error.type}] value=${JSON.stringify(error.value)}: ${error.reason}`;
    case "invalid_price":
    case "invalid_quantity":
    case "invalid_basis_points":
      return `[${error.type}] ${error.field}=${error.value}: ${error.reason}`;
    case "invalid_quote":
    case "invalid_position":
    case "invalid_order_intent":
      return `[${error.type}] ${error.reason}`;
  }
}
