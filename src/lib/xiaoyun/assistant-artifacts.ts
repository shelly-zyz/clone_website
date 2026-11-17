import { z } from "zod";
import { topicSchema } from "@/lib/data-agent/contracts";

const httpsUrl = z.url({ protocol: /^https$/ }).max(1000);
export const evidenceSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().max(200),
  version: z.string().max(100),
  locator: z.string().max(250),
  url: httpsUrl,
  passage: z.string().max(2500),
  retrievedAt: z.iso.datetime(),
  reviewStatus: z.literal("approved"),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const exportReferenceSchema = z.strictObject({
  kind: z.enum(["data", "analysis"]),
  topic: topicSchema,
  id: z.uuid(),
  format: z.enum(["csv", "json"]),
});
export type ExportReference = z.infer<typeof exportReferenceSchema>;
export const exportRequestSchema = exportReferenceSchema.extend({ projectId: z.uuid() });
