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

    const parameters = z.strictObject({ ...scope, model: z.enum(forecastModels), horizon: z.number().int().min(1).max(12) });
    for (const [tool, operation] of [["run_forecast", "forecast"], ["run_backtest", "backtest"], ["compare_models", "compare"]] as const) {
      server.registerTool(tool, {
        description: "在授权的历史数据上排队预测或时间顺序回测任务。", inputSchema: parameters,
      }, ({ model, horizon, ...args }) => mcpResult(() => runAnalysisRequest({
        action: "submit", ...args, plan: { operation, model, horizon },
      }, key, request.signal)));
    }
  });
}
