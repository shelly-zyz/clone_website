import "server-only";

import type { z } from "zod";
import { selectWithPi } from "@/lib/agent-runtime/pi-tool.server";
import { advanceAgentSession, createAgentSession, getAgentSession, getAnalysisJob } from "@/lib/agent-runtime/store";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { assertDataProject, resolveDataResult } from "@/lib/data-agent/state.server";
import { analysisSelectionSchema, planSchema, type analysisRequestSchema } from "./contracts";

type Request = z.infer<typeof analysisRequestSchema>;

function invalid(error: string) {
  return { status: "unsupported" as const, error };
}

export async function runAnalysisRequest(request: Request, key: string | null, signal: AbortSignal) {
  const projectId = request.project_id;
  await assertDataProject(projectId, key);
  if (request.action === "create_session") return createAgentSession(projectId, "analysis");
  if (request.action === "get_job") {
    const job = getAnalysisJob(projectId, request.job_id);
    if (!job) throw new DataAgentError("PROJECT_NOT_FOUND", "该项目没有此分析任务。");
    return job;
  }
  const session = getAgentSession(projectId, request.session_id, "analysis");
  if (!session) throw new DataAgentError("PROJECT_NOT_FOUND", "该项目没有此分析会话。");
  if (request.action === "get_session") return session;
  if (request.revision !== session.revision) throw new DataAgentError("SESSION_CONFLICT", "请刷新分析会话后重试。");
  const resultId = request.result_id ?? session.summary.result_id;
  if (!resultId) return invalid("请先指定该项目中一份已保存的数据库查询结果。");
  const result = await resolveDataResult(projectId, resultId, key);
  signal.throwIfAborted();
  const { metric, rows, data_ref } = result;
  const observations = rows.map(row => ({ date: row.time_start, value: row.value === null ? null : Number(row.value) }));
  if (observations.some(point => point.value !== null && !Number.isFinite(point.value))) {
    return invalid("该查询结果包含无效数值。");
  }
  const valid = observations.filter(point => point.value !== null).length;
  if (!valid) return invalid("该查询结果没有有效观测值。");

  const instruction = request.action === "ask" ? request.instruction : request.plan.operation;
  const selection = request.action === "submit" ? request.plan : await selectWithPi({
    tool: "plan_analysis",
    schema: analysisSelectionSchema,
    signal,
    prompt: [
      "你是 OpenGridWorks 的分析预测 Agent。只调用一次 plan_analysis 提交受控任务。不得推测数值。",
      "describe 是描述统计，cluster 是单变量数值聚类，forecast 是外推，backtest 是留出回测，compare 是与统计基线回测比较。",
      "默认 statsforecast。明确提到 TimesFM 或 Chronos-2 时选择 timesfm 或 chronos2。不得换模型冒充指定模型。",
      "用户追问时沿用 previous 中未改动的 operation、model、horizon 或 clusters。",
      "任务超出所选数据范围、多变量聚类、要求重查原表、或意图不明时，选 unsupported。",
    ].join("\n"),
    context: { instruction, series: { name: metric.name, grain: metric.time_grain, available: valid },
      previous: session.summary.selection, recent: session.recent },
  });
  if (!selection || selection.operation === "unsupported") return invalid("请指定统计、聚类、预测、回测或模型对比任务。");
  const parsed = planSchema.parse(selection);
  const operation = parsed.operation;
  const predicting = operation === "forecast" || operation === "backtest" || operation === "compare";
  if (predicting && (metric.data_identity === "forecast" || !["month", "day"].includes(metric.time_grain))) {
    return invalid("预测和回测需要日度或月度历史观测。已发布的气象预报帧可以做描述统计。");
  }
  const plan = predicting ? { operation, model: parsed.model ?? "statsforecast", horizon: parsed.horizon ?? 3 }
    : operation === "cluster" ? { operation, clusters: parsed.clusters ?? 3 } : { operation };
  if (predicting && valid < 8) return invalid("预测需要至少 8 条连续历史观测。请保存更长的时间范围。");
  signal.throwIfAborted();
  const saved = advanceAgentSession(session, "analysis", { result_id: resultId, selection: plan },
    { instruction, status: "queued", selection: plan },
    { plan, input: { observations, grain: metric.time_grain, unit: metric.unit, metric: metric.name, source_name: metric.source_name }, data_ref });
  if (saved.status === "conflict") throw new DataAgentError("SESSION_CONFLICT", "分析会话已有新消息，请刷新后重试。");
  if (saved.status === "busy") throw new DataAgentError("BUSY", "分析队列已满，请等待现有任务完成。");
  return { status: "queued" as const, job_id: saved.job_id, session_id: session.session_id, revision: saved.revision, plan, data_ref };
}
