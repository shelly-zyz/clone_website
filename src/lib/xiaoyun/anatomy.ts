import { z } from "zod";

export const mechanismShapes = ["rotor", "gear", "coil", "tank", "filter", "switch", "panel", "cabinet"] as const;

export const mechanismSchema = z.strictObject({
  title: z.string().trim().min(2).max(70),
  introduction: z.string().trim().min(8).max(220),
  parts: z.array(z.strictObject({
    name: z.string().trim().min(1).max(32),
    shape: z.enum(mechanismShapes),
    explanation: z.string().trim().min(8).max(200),
  })).min(2).max(5),
  takeaway: z.string().trim().min(8).max(200),
});

export type Mechanism = z.infer<typeof mechanismSchema>;
