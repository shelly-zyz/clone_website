import { analysisOperations, analysisRequestSchema } from "@/lib/analysis-agent/contracts";
import { enabledForecastModels, runAnalysisRequest } from "@/lib/analysis-agent/analysis.server";
import { authorizeDataAgent, dataAgentErrorResponse, isXiaoyunSshPreviewRequest } from "@/lib/data-agent/http.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  return Response.json({ operations: analysisOperations, models: enabledForecastModels(), execution: "queued" });
}

export async function POST(request: Request) {
  const preview = isXiaoyunSshPreviewRequest(request);
  if (!preview) {
    const unauthorized = authorizeDataAgent(request);
    if (unauthorized) return unauthorized;
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "请求必须使用 JSON。" }, { status: 415 });
  }
  const raw = await request.text().catch(() => "");
  if (raw.length > 4096) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const parsed = analysisRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ code: "INVALID_REQUEST", issues: parsed.error.issues }, { status: 400 });
  if (preview && parsed.data.action !== "get_job") {
    const unauthorized = authorizeDataAgent(request);
    if (unauthorized) return unauthorized;
  }
  try {
    const reply = await runAnalysisRequest(parsed.data, request.headers.get("x-data-project-key"), request.signal);
    const status = "status" in reply && reply.status === "unsupported" ? 422
      : parsed.data.action === "ask" || parsed.data.action === "submit" ? 202 : 200;
    return Response.json(reply, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
