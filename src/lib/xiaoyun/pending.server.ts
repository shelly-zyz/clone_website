import "server-only";

import { z } from "zod";
import { planSchema } from "@/lib/analysis-agent/contracts";
import { DataAgentError, runDataAgentWrite } from "@/lib/data-agent/database.server";

export const pendingAnalysisSchema = z.strictObject({
  token: z.uuid(), resultId: z.uuid(), revision: z.number().int(), expiresAt: z.number(),
  plan: planSchema, reason: z.string().max(300),
});
export type PendingAnalysis = z.infer<typeof pendingAnalysisSchema>;

type Scope = { project_id: string; session_id: string };
export function updatePendingAnalysis(scope: Scope, revision: number, expected: string | undefined, pending: PendingAnalysis | null) {
  return runDataAgentWrite("green_agent_context", async client => {
    const result = await client.query(`
      UPDATE projects.data_session SET xiaoyun_analysis_pending=$1::jsonb
      WHERE id=$2 AND project_id=$3 AND revision=$4
        AND (xiaoyun_analysis_pending->>'token' IS NOT DISTINCT FROM $5::text)
    `, [pending && JSON.stringify(pending), scope.session_id, scope.project_id, revision, expected ?? null]);
    if (!result.rowCount) throw new DataAgentError("SESSION_CONFLICT", "待续办的分析已更新，请刷新后重试。");
  });
}
