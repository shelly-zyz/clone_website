import { analysisResultSchema } from "@/lib/agent-runtime/analysis-result";
import { z } from "zod";
import type { TaskSource } from "@xiaoyun/voice";
import { topicSchema, type Topic } from "@/lib/data-agent/contracts";
import { analysisOperations, forecastModels } from "@/lib/analysis-agent/contracts";

const businessSessionSchema = z.strictObject({ session_id: z.uuid() });

const sessionSchema = z.strictObject({
  project_id: z.uuid(),
  project_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  session_id: z.uuid(),
  visualization: businessSessionSchema.optional(),
  analysis: businessSessionSchema.optional(),
});

export const xiaoyunContextSchema = z.strictObject({
  threadId: z.string().max(80).nullable().optional(),
  sessions: z.partialRecord(topicSchema, sessionSchema).optional(),
  lastTopic: topicSchema.optional(),
  lastRoute: z.enum(["data", "visualization", "analysis"]).optional(),
});

export const xiaoyunRequestSchema = z.strictObject({
  requestId: z.uuid().optional(),
  message: z.string().trim().min(1).max(300),
  topic: topicSchema,
  context: xiaoyunContextSchema,
  selectedChart: z.strictObject({ topic: topicSchema, chart_id: z.uuid() }).optional(),
});

export type XiaoyunRequest = z.infer<typeof xiaoyunRequestSchema>;
export type XiaoyunContext = z.infer<typeof xiaoyunContextSchema>;
export type XiaoyunSession = z.infer<typeof sessionSchema>;

export const analysisJobSchema = z.object({
  job_id: z.uuid(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  plan: z.object({
    operation: z.enum(analysisOperations),
    model: z.enum(forecastModels).optional(),
    horizon: z.number().optional(),
  }),
  result: analysisResultSchema.nullable(),
  error: z.string().nullable(),
  data_ref: z.object({
    version: z.string(),
    time_range: z.object({ start: z.string().nullable(), end: z.string().nullable() }).optional(),
  }),
});

export const xiaoyunAnalysisArtifactSchema = z.object({
  kind: z.literal("analysis"),
  topic: topicSchema,
  jobId: z.uuid(),
  projectId: z.uuid(),
  operation: z.enum(analysisOperations).optional(),
});

export type XiaoyunAnalysisArtifact = z.infer<typeof xiaoyunAnalysisArtifactSchema>;

type DashboardDetails = {
  unit: string;
  timeRange: { start: string | null; end: string | null };
  validRows: number;
  missingRows: number;
  truncated: boolean;
  sourceName: string;
  sources: TaskSource[];
};

export type XiaoyunBusinessResult =
  | { kind: "chart"; topic: Topic; chartId: string; title: string; renderer: "echarts" | "mcp-echarts" | "vchart" | "antv"; options: Record<string, unknown>; version: string; dashboard?: DashboardDetails }
  | XiaoyunAnalysisArtifact;

export type XiaoyunReply = {
  runId?: string;
  route: "data" | "general" | "sources" | "clarify" | "visualization" | "analysis";
  summary: string;
  markdown?: string;
  sources?: TaskSource[];
  data?: Record<string, unknown>;
  threadId?: string;
  session?: { topic: Topic; scope: XiaoyunSession };
  lastTopic?: Topic;
  lastRoute?: XiaoyunContext["lastRoute"];
  business?: XiaoyunBusinessResult;
  artifacts?: XiaoyunBusinessResult[];
};
