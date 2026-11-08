import { DataAgentError } from "@/lib/data-agent/database.server";
import { authorizeDataAgent, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { chartBackends, chartTypes, visualizationRequestSchema } from "@/lib/visualization-agent/contracts";
import { visualizeResult } from "@/lib/visualization-agent/visualization.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  return Response.json({
    renderer: "mcp-echarts", chart_backends: chartBackends, charts: chartTypes, scenes: ["maplibre", "three"],
    actions: ["render", "ask", "ask_session", "create_session", "get_session", "scene"],
  });
}

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "请求必须使用 JSON。" }, { status: 415 });
  }
  const raw = await request.text().catch(() => "");
  if (raw.length > 4096) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const input = visualizationRequestSchema.safeParse(body);
  if (!input.success) return Response.json({ code: "INVALID_REQUEST", issues: input.error.issues }, { status: 400 });

  try {
    const reply = await visualizeResult(input.data, request.headers.get("x-data-project-key"), request.signal);
    const status = "status" in reply && reply.status !== "ok" ? 422 : 200;
    return Response.json(reply, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DataAgentError) return dataAgentErrorResponse(error);
    return Response.json({ code: "UNAVAILABLE", error: "暂时无法生成图表，请稍后重试。" }, { status: 503 });
  }
}
