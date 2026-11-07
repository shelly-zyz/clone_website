import { dataRequestSchema, topicSchema } from "@/lib/data-agent/contracts";
import { authorizeDataAgent, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { askDataAgent } from "@/lib/data-agent/pi.server";
import { listDataCatalog, queryData } from "@/lib/data-agent/query.server";
import { askDataSession, createDataProject, createDataSession, readDataSession, resolveDataResult } from "@/lib/data-agent/state.server";

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
  const key = request.headers.get("x-data-project-key");
  try {
    const reply = (result: object) => Response.json(result, { headers: { "Cache-Control": "no-store" } });
    switch (data.action) {
      case "catalog": return reply(await listDataCatalog(data.topic));
      case "query": return reply(await queryData(data.query));
      case "create_project": return reply(await createDataProject(data.topic, data.name));
      case "create_session": return reply(await createDataSession(data.project_id, key));
      case "get_session": return reply(await readDataSession(data.project_id, data.session_id, key));
      case "resolve_result": return reply(await resolveDataResult(data.project_id, data.result_id, key));
      case "ask": return reply(data.session
        ? await askDataSession(data.topic, data.question, data.session, key, request.signal)
        : await askDataAgent(data.topic, data.question, request.signal));
    }
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
