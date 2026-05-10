import { describe, expect, test } from "bun:test";
import { BulkHttpError } from "bulk-ts-sdk";

import { summarizeError } from "../../scripts/checkBulkPrivateApi.ts";

describe("checkBulkPrivateApi", () => {
  test("preserves Bulk HTTP response data for failed preflight evidence", () => {
    const result = summarizeError(new BulkHttpError(408, { message: "upstream timeout" }));

    expect(result).toEqual({
      error: 'BulkHttpError: HTTP error 408: {"message":"upstream timeout"}',
      name: "BulkHttpError",
      status: 408,
      data: { message: "upstream timeout" },
    });
  });
});
