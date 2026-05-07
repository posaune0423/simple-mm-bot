import { z } from "zod";

export const bulkBetaLeaderboardParamsSchema = z
  .object({
    baseHalfSpreadBps: z.number().positive(),
    minHalfSpreadBps: z.number().positive(),
    maxHalfSpreadBps: z.number().positive(),
    volatilitySpreadMultiplier: z.number().min(0),
    inventorySoftLimitQty: z.number().positive(),
    inventoryHardLimitQty: z.number().positive(),
    sameSideSizeMultiplierAtSoft: z.number().min(0).max(1),
    reduceSideSizeMultiplierAtSoft: z.number().min(1),
  })
  .refine((params) => params.maxHalfSpreadBps >= params.minHalfSpreadBps, {
    message: "maxHalfSpreadBps must be greater than or equal to minHalfSpreadBps",
    path: ["maxHalfSpreadBps"],
  })
  .refine((params) => params.inventoryHardLimitQty >= params.inventorySoftLimitQty, {
    message: "inventoryHardLimitQty must be greater than or equal to inventorySoftLimitQty",
    path: ["inventoryHardLimitQty"],
  });

export type BulkBetaLeaderboardParams = z.infer<typeof bulkBetaLeaderboardParamsSchema>;
