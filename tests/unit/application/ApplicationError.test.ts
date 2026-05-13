import { describe, expect, test } from "bun:test";

import {
  ApplicationError,
  formatApplicationError,
  isApplicationError,
} from "../../../src/application/errors/ApplicationError.ts";
import { OrderReconcileFailedError } from "../../../src/application/services/ManagedOrderReconciler.ts";
import { OrderIntentBuildFailedError } from "../../../src/application/services/OrderIntentBuilder.ts";

describe("ApplicationError", () => {
  test("application service errors share a layer-owned Error base", () => {
    const cause = new Error("gateway rejected");
    const error = new OrderReconcileFailedError(cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe("OrderReconcileFailedError");
    expect(error.code).toBe("application.managed_order_reconciler.reconcile_failed");
    expect(error.cause).toBe(cause);
    expect(isApplicationError(error)).toBe(true);
  });

  test("formats code, message, and context consistently", () => {
    const error = new OrderIntentBuildFailedError("missing placement touch for quote leg", {
      key: "bid:0",
    });

    expect(formatApplicationError(error)).toBe(
      "[application.order_intent_builder.build_failed] missing placement touch for quote leg key=bid:0",
    );
    expect(isApplicationError(new Error("plain"))).toBe(false);
  });
});
