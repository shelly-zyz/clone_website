import "server-only";

import type { z } from "zod";
import { selectWithPi } from "@/lib/agent-runtime/pi-tool.server";
import { advanceAgentSession, createAgentSession, getAgentSession, getAnalysisJob } from "@/lib/agent-runtime/store";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { profileDataResult } from "@/lib/data-agent/result-profile";
import { assertDataProject, resolveDataResult } from "@/lib/data-agent/state.server";
import { analysisSelectionSchema, forecastModels, planSchema, type analysisRequestSchema } from "./contracts";

type Request = z.infer<typeof analysisRequestSchema>;

function invalid(error: string) {
  return { status: "unsupported" as const, error };
}

export function enabledForecastModels() {
  const configured = process.env.OGW_ANALYSIS_ENABLED_MODELS;
  if (configured === undefined) return forecastModels;
  const models = new Set(configured.split(",").map(model => model.trim()));
  return forecastModels.filter(model => models.has(model));
}

export async function runAnalysisRequest(request: Request, key: string | null, signal: AbortSignal, jobId?: string) {
  const projectId = request.project_id;
  await assertDataProject(projectId, key);
  if (request.action === "create_session") return await createAgentSession(projectId, "analysis");
  if (request.action === "get_job") {
    const job = await getAnalysisJob(projectId, request.job_id);
    if (!job) throw new DataAgentError("PROJECT_NOT_FOUND", "该项目没有此分析任务。");
    return job;
  }
  const session = await getAgentSession(projectId, request.session_id, "analysis");
  if (!session) throw new DataAgentError("PROJECT_NOT_FOUND", "该项目没有此分析会话。");
  if (request.action === "get_session") return session;
  if (jobId) {
    const existing = await getAnalysisJob(projectId, jobId);
    if (existing) return { ...existing, session_id: existing.analysis_session_id ?? session.session_id, reused: true as const };
  }
  if (request.revision !== session.revision) throw new DataAgentError("SESSION_CONFLICT", "请刷新分析会话后重试。");
  const resultId = request.result_id ?? session.summary.result_id;
  if (!resultId) return invalid("请先指定该项目中一份已保存的数据库查询结果。");
  const result = await resolveDataResult(projectId, resultId, key);
  signal.throwIfAborted();
  const { metric, rows, data_ref } = result;
  const profile = profileDataResult(result);
  if (profile.invalid) return invalid("该查询结果包含无效时间或数值。");
  if (!profile.valid) return invalid("该查询结果没有有效观测值。");

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
    context: { instruction, series: { name: metric.name, grain: metric.time_grain, available: profile.valid,
      continuous: profile.continuous, capabilities: profile.analysis },
      enabledModels: enabledForecastModels(),
      previous: session.summary.selection, recent: session.recent },
  });
  if (!selection || selection.operation === "unsupported") return invalid("请指定统计、聚类、预测、回测或模型对比任务。");
  const parsed = planSchema.parse(selection);
  const operation = parsed.operation;
  const predicting = operation === "forecast" || operation === "backtest" || operation === "compare";
  if (predicting && !profile.historical) {
    return invalid("预测和回测需要日度或月度历史观测。已发布的气象预报帧可以做描述统计。");
  }
  const plan = predicting ? { operation, model: parsed.model ?? "statsforecast", horizon: parsed.horizon ?? 3 }
    : operation === "cluster" ? { operation, clusters: parsed.clusters ?? 3 } : { operation };
  if (predicting && !profile.analysis.forecast) {
    return invalid(`数据末尾只有 ${profile.continuous} 期连续观测。预测或回测至少需要 8 期连续训练数据，请查询一段连续历史。`);
  }
  if ((operation === "backtest" || operation === "compare") && (plan.horizon ?? 3) > profile.analysis.maxHoldout) {
    return invalid(`留出 ${plan.horizon} 期后不足 8 期训练观测；当前最多留出 ${profile.analysis.maxHoldout} 期，请缩短留出窗口或扩大历史范围。`);
  }
  if (predicting && !enabledForecastModels().includes(plan.model ?? "statsforecast")) {
    return invalid(`当前部署未启用 ${plan.model}，请选择已启用的模型。`);
  }
  if (operation === "cluster" && (plan.clusters ?? 3) > profile.analysis.maxClusters) {
    return invalid(`当前最多支持 ${profile.analysis.maxClusters} 组，有效的不同数值少于请求的分组数。`);
  }
  const observations = rows.map(row => ({ date: row.time_start, value: row.value === null ? null : Number(row.value) }));
  signal.throwIfAborted();
  const saved = await advanceAgentSession(session, "analysis", { result_id: resultId, selection: plan },
    { instruction, status: "queued", selection: plan },
    { plan, input: { observations, grain: metric.time_grain, unit: metric.unit, metric: metric.name, source_name: metric.source_name,
      analysis_session_id: session.session_id },
      data_ref, job_id: jobId });
  if (saved.status === "reused") {
    const existing = await getAnalysisJob(projectId, saved.job_id);
    if (existing) return { ...existing, session_id: existing.analysis_session_id ?? session.session_id, reused: true as const };
    throw new Error("Reused analysis job is missing.");
  }
  if (saved.status === "conflict") throw new DataAgentError("SESSION_CONFLICT", "分析会话已有新消息，请刷新后重试。");
  if (saved.status === "busy") throw new DataAgentError("BUSY", "分析队列已满，请等待现有任务完成。");
  return { status: "queued" as const, job_id: saved.job_id, session_id: session.session_id, revision: saved.revision, plan, data_ref };
}
