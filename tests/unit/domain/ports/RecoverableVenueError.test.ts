import { describe, expect, test } from "bun:test";

import {
  isRecoverableVenueError,
  RecoverableVenueError,
} from "../../../../src/domain/ports/RecoverableVenueError.ts";

describe("RecoverableVenueError", () => {
  test("marks transient venue failures without exposing venue-specific classifiers to application code", () => {
    const cause = Object.assign(new Error("HTTP error 408"), {
      name: "BulkHttpError",
      status: 408,
    });
    const error = new RecoverableVenueError("transient venue failure", {
      venue: "bulk",
      operation: "sync_fills",
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("venue.recoverable");
    expect(error.venue).toBe("bulk");
    expect(error.operation).toBe("sync_fills");
    expect(error.cause).toBe(cause);
    expect(isRecoverableVenueError(error)).toBe(true);
    expect(isRecoverableVenueError(cause)).toBe(false);
  });
});
