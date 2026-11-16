import { authorizeXiaoyun, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { exportRequestSchema } from "@/lib/xiaoyun/assistant-artifacts";
import { exportResult } from "@/lib/xiaoyun/export.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = authorizeXiaoyun(request);
  if (denied) return denied;
  const raw = await request.text();
  if (raw.length > 1200) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const parsed = exportRequestSchema.safeParse(value);
  if (!parsed.success) return Response.json({ error: "无效的导出引用。" }, { status: 400 });
  try {
    const { projectId, ...reference } = parsed.data;
    const { contents, extension, type } = await exportResult(reference, projectId, request.headers.get("X-Data-Project-Key"));
    return new Response(contents, { headers: {
      "Content-Type": type, "Content-Disposition": `attachment; filename="opengridworks-${reference.id}.${extension}"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
