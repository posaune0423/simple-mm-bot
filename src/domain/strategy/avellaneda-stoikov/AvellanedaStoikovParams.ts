import { z } from "zod";

export const avellanedaStoikovParamsSchema = z.object({
  gamma: z.number().min(0).max(0.5),
  kappa: z.number().positive(),
  kInv: z.number().min(0).max(2),
});

export type AvellanedaStoikovParams = z.infer<typeof avellanedaStoikovParamsSchema>;
