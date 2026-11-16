import "server-only";

import { z } from "zod";
import { appendBusinessAudit } from "@/lib/agent-runtime/policy.server";
import { runDataAgentWrite } from "@/lib/data-agent/database.server";
import { assertDataProject } from "@/lib/data-agent/state.server";
import { chartReferenceSchema } from "@/lib/visualization-agent/contracts";
import type { XiaoyunSession } from "./contracts";
import { activePageSchema } from "./page-actions";

const projectViewSchema = z.strictObject({
  page: activePageSchema,
  chart: chartReferenceSchema.optional(),
  dataVersion: z.string().max(150).optional(),
});

type ProjectView = z.infer<typeof projectViewSchema>;

export async function saveProjectView(scope: XiaoyunSession, name: string, snapshot: ProjectView) {
  await assertDataProject(scope.project_id, scope.project_key);
  const value = projectViewSchema.parse(snapshot);
  await runDataAgentWrite("green_agent_context", async client => {
    await client.query(`
      INSERT INTO projects.xiaoyun_project_view(project_id,name,snapshot) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(project_id,name) DO UPDATE SET snapshot=excluded.snapshot,updated_at=now()
    `, [scope.project_id, name, JSON.stringify(value)]);
    await appendBusinessAudit(client, { actor: "xiaoyun", action: "save_project_view", outcome: "ok",
      project_id: scope.project_id, result_id: value.chart?.result_id });
  });
}

export async function listProjectViews(scope: XiaoyunSession) {
  await assertDataProject(scope.project_id, scope.project_key);
  return runDataAgentWrite("green_agent_context", async client => {
    const { rows } = await client.query<{ name: string; view: string; updated_at: Date }>(`
      SELECT name,snapshot#>>'{page,view}' AS view,updated_at FROM projects.xiaoyun_project_view
      WHERE project_id=$1 ORDER BY updated_at DESC,name LIMIT 25
    `, [scope.project_id]);
    return rows;
  });
}

export async function loadProjectView(scope: XiaoyunSession, name: string) {
  await assertDataProject(scope.project_id, scope.project_key);
  return runDataAgentWrite("green_agent_context", async client => {
    const { rows: [row] } = await client.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM projects.xiaoyun_project_view WHERE project_id=$1 AND name=$2", [scope.project_id, name]);
    return row ? projectViewSchema.parse(row.snapshot) : undefined;
  });
}
