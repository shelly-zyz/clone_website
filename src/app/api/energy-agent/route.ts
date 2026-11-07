import { isEnergyTechnology } from "@/lib/energy-agent/contracts";
import { runEnergyRequest } from "@/lib/energy-agent/run.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "请从工作台提交 JSON 请求。" }, { status: 415 });
  }
  const raw = await request.text().catch(() => "");
  if (raw.length > 3500) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效的查询请求。" }, { status: 400 }); }
  const question = typeof body === "object" && body !== null && "question" in body && typeof body.question === "string"
    ? body.question.trim() : "";
  const technology = typeof body === "object" && body !== null && "technology" in body ? body.technology : "all";
  if (!question || question.length > 400 || (technology !== "all" && !isEnergyTechnology(technology))) {
    return Response.json({ error: "请输入 1–400 字的能源问题，并选择有效的技术范围。" }, { status: 400 });
  }
  try {
    const result = await runEnergyRequest({ question, technology }, request.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "能源工作台暂时无法完成本次查询。" }, { status: 503 });
  }
}
