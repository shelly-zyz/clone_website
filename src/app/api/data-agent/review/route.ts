import { appendBusinessAudit, withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { z } from "zod";
import { DataAgentError, runDataAgentWrite } from "@/lib/data-agent/database.server";
import { authorizeDataAgent, dataAgentErrorResponse } from "@/lib/data-agent/http.server";

export const runtime = "nodejs";

const decision = z.strictObject({ batch_id: z.uuid(), approve: z.boolean(), note: z.string().trim().min(1).max(500) });

export async function GET(request: Request) {
  const unauthorized = authorizeDataAgent(request, true);
  if (unauthorized) return unauthorized;
  try {
    const payload = await runDataAgentWrite("green_agent_review", async (client) => {
      const { rows } = await client.query(`
        SELECT id, period_month::text, source_url, source_sha256, observations, issues, status, version,
          review_note, current_values
        FROM staging.nbs_release_review
        ORDER BY (status = 'pending') DESC, submitted_at DESC LIMIT 50`);
      const { rows: [last_check] } = await client.query(
        "SELECT checked_at, status FROM staging.nbs_refresh_run ORDER BY checked_at DESC LIMIT 1");
      return { batches: rows, last_check: last_check ?? null };
    });
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request, true);
  if (unauthorized) return unauthorized;
  const raw = await request.text().catch(() => "");
  if (raw.length > 4096) return Response.json({ error: "请求内容过长。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "无效 JSON。" }, { status: 400 }); }
  const input = decision.safeParse(body);
  if (!input.success) return Response.json({ error: "请填写有效的批次、决定和审核原因。" }, { status: 400 });
  const { batch_id, approve, note } = input.data;
  try {
    const applied = await withBusinessAction("review", approve ? "approve" : "reject", () => runDataAgentWrite("green_agent_review", async (client) => {
      const { rows } = await client.query<{ applied: boolean }>(
        "SELECT staging.review_nbs_release($1,$2,$3) AS applied", [batch_id, approve, note]);
      if (rows[0].applied) await appendBusinessAudit(client, { actor: "review", action: approve ? "approve" : "reject", outcome: "ok", batch_id });
      return { status: rows[0].applied ? "ok" : "conflict", applied: rows[0].applied };
    }));
    if (!applied.applied) throw new DataAgentError("REVIEW_CONFLICT", "该批次已处理，请刷新。");
    return Response.json({ applied: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["22023", "P0002"].includes(String(error.code))) {
      return Response.json({ error: "该批次无法批准。请检查校验问题和批次状态。" }, { status: 409 });
    }
    return dataAgentErrorResponse(error);
  }
}
