import { z } from "zod";
import { forecastModels } from "@/lib/analysis-agent/contracts";
import { runAnalysisRequest } from "@/lib/analysis-agent/analysis.server";
import { sessionInput } from "@/lib/agent-runtime/context";
import { mcpResult, serveAgentMcp } from "@/lib/agent-runtime/mcp.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const key = request.headers.get("x-data-project-key");
  return serveAgentMcp(request, "opengridworks-analysis", server => {
    server.registerTool("create_analysis_session", {
      description: "在有权访问的数据项目中建立独立分析会话。",
      inputSchema: z.strictObject({ project_id: z.uuid() }),
    }, args => mcpResult(() => runAnalysisRequest({ action: "create_session", ...args }, key, request.signal)));
    server.registerTool("read_analysis_job", {
      description: "获取项目分析任务状态、DataRef 与计算结果。",
      inputSchema: z.strictObject({ project_id: z.uuid(), job_id: z.uuid() }),
    }, args => mcpResult(() => runAnalysisRequest({ action: "get_job", ...args }, key, request.signal)));

    const scope = { ...sessionInput, result_id: z.uuid().optional() };
    server.registerTool("describe_series", {
      description: "对已保存的单指标序列提交描述统计任务。", inputSchema: z.strictObject(scope),
    }, args => mcpResult(() => runAnalysisRequest({ action: "submit", ...args, plan: { operation: "describe" } }, key, request.signal)));
    server.registerTool("cluster_series", {
      description: "提交单变量 KMeans 聚类任务。",
      inputSchema: z.strictObject({ ...scope, clusters: z.number().int().min(2).max(5) }),
    }, ({ clusters, ...args }) => mcpResult(() => runAnalysisRequest({ action: "submit", ...args, plan: { operation: "cluster", clusters } }, key, request.signal)));

    const forecastFields = { ...scope, model: z.enum(forecastModels).optional(),
      horizon: z.number().int().min(1).max(12), horizonUnit: z.enum(["day", "month", "period"]).optional() };
    server.registerTool("run_forecast", {
      description: "用指定模型或轻量基线预测；strategy=auto 先用滚动回测选择统计模型。",
      inputSchema: z.strictObject({ ...forecastFields, strategy: z.literal("auto").optional() }),
    }, ({ model, horizon, horizonUnit, strategy, ...args }) => mcpResult(() => runAnalysisRequest({
      action: "submit", ...args, plan: { operation: "forecast", model, horizon, horizonUnit, strategy },
    }, key, request.signal)));
    for (const [tool, operation] of [["run_backtest", "backtest"], ["compare_models", "compare"]] as const) {
      server.registerTool(tool, {
        description: operation === "compare" ? "指定模型与基线对比；省略模型时滚动比较统计候选。"
          : "在同一时间序列上按时间顺序留出回测。",
        inputSchema: z.strictObject(forecastFields),
      }, ({ model, horizon, horizonUnit, ...args }) => mcpResult(() => runAnalysisRequest({
        action: "submit", ...args, plan: { operation: operation === "compare" && !model ? "select_model" : operation,
          model, horizon, horizonUnit },
      }, key, request.signal)));
    }
  });
}
