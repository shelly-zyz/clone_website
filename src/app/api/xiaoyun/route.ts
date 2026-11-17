import { authorizeXiaoyun, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { xiaoyunRequestSchema } from "@/lib/xiaoyun/contracts";
import { xiaoyunStreamType, type XiaoyunStreamEvent } from "@/lib/xiaoyun/stream";
import { askXiaoyun } from "@/lib/xiaoyun/supervisor.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeXiaoyun(request);
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
  if (request.headers.get("accept")?.includes(xiaoyunStreamType)) {
    const encoder = new TextEncoder();
    const disconnect = new AbortController();
    const signal = AbortSignal.any([request.signal, disconnect.signal]);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: XiaoyunStreamEvent) => {
          if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          const reply = await askXiaoyun(input.data, signal, emit);
          emit({ type: "result", reply });
        } catch (error) {
          if (!signal.aborted) {
            const payload: { error: string } = await dataAgentErrorResponse(error).json();
            emit({ type: "error", error: payload.error });
          }
        } finally {
          if (!disconnect.signal.aborted) controller.close();
        }
      },
      cancel() { disconnect.abort(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": xiaoyunStreamType, "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
    } });
  }
  try {
    return Response.json(await askXiaoyun(input.data, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
