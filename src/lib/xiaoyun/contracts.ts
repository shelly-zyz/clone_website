import { z } from "zod";
import type { TaskSource } from "@xiaoyun/voice";
import { topicSchema, type Topic } from "@/lib/data-agent/contracts";

const sessionSchema = z.strictObject({
  project_id: z.uuid(),
  project_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  session_id: z.uuid(),
});

export const xiaoyunContextSchema = z.strictObject({
  threadId: z.string().max(80).nullable().optional(),
  sessions: z.partialRecord(topicSchema, sessionSchema).optional(),
  lastTopic: topicSchema.optional(),
});

export const xiaoyunRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(300),
  topic: topicSchema,
  context: xiaoyunContextSchema,
});

export type XiaoyunRequest = z.infer<typeof xiaoyunRequestSchema>;
export type XiaoyunContext = z.infer<typeof xiaoyunContextSchema>;
export type XiaoyunSession = z.infer<typeof sessionSchema>;

export type XiaoyunReply = {
  route: "data" | "general" | "sources" | "clarify";
  summary: string;
  markdown?: string;
  sources?: TaskSource[];
  data?: Record<string, unknown>;
  threadId?: string;
  session?: { topic: Topic; scope: XiaoyunSession };
  lastTopic?: Topic;
};
