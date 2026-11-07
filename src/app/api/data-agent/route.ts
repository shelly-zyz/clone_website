import { dataRequestSchema, topicSchema } from "@/lib/data-agent/contracts";
import { authorizeDataAgent, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { askDataAgent } from "@/lib/data-agent/pi.server";
import { listDataCatalog, queryData } from "@/lib/data-agent/query.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  const topic = topicSchema.optional().safeParse(new URL(request.url).searchParams.get("topic") ?? undefined);
  if (!topic.success) return Response.json({ error: "专题不存在。" }, { status: 400 });
  try {
    return Response.json(await listDataCatalog(topic.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "请求必须使用 JSON。" }, { status: 415 });
  }
  const raw = await request.text().catch(() => "");
  if (raw.length > 8192) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const input = dataRequestSchema.safeParse(body);
  if (!input.success) return Response.json({ code: "INVALID_REQUEST", issues: input.error.issues }, { status: 400 });

  const data = input.data;
  try {
    const result = data.action === "catalog" ? await listDataCatalog(data.topic)
      : data.action === "query" ? await queryData(data.query)
        : await askDataAgent(data.topic, data.question, request.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
