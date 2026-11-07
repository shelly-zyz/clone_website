import { z } from "zod";
import { authorizeDataAgent, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { askMapAssistant } from "@/lib/data-agent/map-assistant.server";

export const runtime = "nodejs";

const inputSchema = z.strictObject({
  message: z.string().trim().min(1).max(1000),
  threadId: z.string().trim().max(80).nullish(),
});

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  const raw = await request.text().catch(() => "");
  if (raw.length > 4096) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "请输入 1–1000 字的问题。" }, { status: 400 });
  try {
    const { message, threadId } = parsed.data;
    return Response.json(await askMapAssistant(message, threadId ?? null, request.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
