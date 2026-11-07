import { z } from "zod";
import { mcpResult, serveAgentMcp } from "@/lib/agent-runtime/mcp.server";
import { chartBackends, chartTypes, sceneFields } from "@/lib/visualization-agent/contracts";
import { visualizeResult } from "@/lib/visualization-agent/visualization.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const key = request.headers.get("x-data-project-key");
  return serveAgentMcp(request, "opengridworks-visualization", server => {
    const inputSchema = z.strictObject({ project_id: z.uuid(), result_id: z.uuid(), chart: z.enum(chartTypes) });
    for (const renderer of chartBackends) {
      server.registerTool(`render_${renderer}`, {
        description: "基于授权的单指标 DataRef 生成本地图表配置。", inputSchema,
      }, args => mcpResult(() => visualizeResult({ action: "render", renderer, ...args }, key, request.signal)));
    }
    server.registerTool("build_power_globe_scene", {
      description: "按已发布 OSM 电力点构建 MapLibre 地球或 Three.js 三维点图。", inputSchema: z.strictObject(sceneFields),
    }, args => mcpResult(() => visualizeResult({ action: "scene", ...args }, key, request.signal)));
  });
}
