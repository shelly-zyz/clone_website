import { DataAgentError } from "@/lib/data-agent/database.server";
import { authorizeDataAgent, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { xiaoyunRequestSchema } from "@/lib/xiaoyun/contracts";
import { askXiaoyun } from "@/lib/xiaoyun/supervisor.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "请求必须使用 JSON。" }, { status: 415 });
  }
  const raw = await request.text();
  if (raw.length > 4096) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const input = xiaoyunRequestSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "请输入问题并检查会话信息。" }, { status: 400 });
  try {
    return Response.json(await askXiaoyun(input.data, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof DataAgentError) && !request.signal.aborted) {
      console.error("Xiaoyun request failed:", error instanceof Error ? error.message : "unknown error");
    }
    return dataAgentErrorResponse(error);
  }
}
