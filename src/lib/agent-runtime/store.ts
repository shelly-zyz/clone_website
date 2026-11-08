import "server-only";

import { randomUUID } from "node:crypto";

import { appendBusinessAudit, businessLimits } from "./policy.server";
import { runDataAgentWrite } from "@/lib/data-agent/database.server";

export type AgentKind = "analysis" | "visualization";
type Turn = { instruction: string; status: string; selection?: unknown };
type Context = { result_id?: string; selection?: unknown; job_id?: string; chart_id?: string };
export type Snapshot = { session_id: string; project_id: string; revision: number; summary: Context; recent: Turn[] };
type Task = { plan: unknown; input: unknown; data_ref: unknown; job_id?: string };
type SessionRow = { id: string; project_id: string; revision: number; summary: Context; recent: Turn[] };
type JobRow = {
  id: string; status: "queued" | "running" | "succeeded" | "failed"; attempt: number; plan: unknown;
  analysis_session_id: string | null;
  data_ref: unknown; result: unknown | null; error: string | null; created_at: Date; updated_at: Date;
};

export async function createAgentSession(projectId: string, kind: AgentKind, stableId: string = randomUUID()) {
  return runDataAgentWrite("green_agent_context", async client => {
    await client.query(
      "INSERT INTO projects.agent_session(id,project_id,kind) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING", [stableId, projectId, kind]);
    const { rows: [row] } = await client.query<SessionRow>(
      "SELECT id,project_id,revision,summary,recent FROM projects.agent_session WHERE id=$1 AND project_id=$2 AND kind=$3",
      [stableId, projectId, kind]);
    if (!row) throw new Error("Agent session identity conflict.");
    return { session_id: row.id, project_id: row.project_id, revision: row.revision, summary: row.summary, recent: row.recent };
  });
}

export async function getAgentSession(projectId: string, id: string, kind: AgentKind): Promise<Snapshot | undefined> {
  return runDataAgentWrite("green_agent_context", async client => {
    const { rows } = await client.query<SessionRow>(`
      SELECT id,project_id,revision,summary,recent FROM projects.agent_session
      WHERE id=$1 AND project_id=$2 AND kind=$3
    `, [id, projectId, kind]);
    const row = rows[0];
    return row && { session_id: row.id, project_id: row.project_id, revision: row.revision, summary: row.summary, recent: row.recent };
  });
}

export async function advanceAgentSession(
  session: Snapshot, kind: AgentKind, summary: Context, turn: Turn, task?: Task,
) {
  return runDataAgentWrite("green_agent_context", async client => {
    if (task?.job_id) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [task.job_id]);
      const prior = await client.query(
        "SELECT 1 FROM results.analysis_job WHERE id=$1 AND project_id=$2", [task.job_id, session.project_id]);
      if (prior.rowCount) return { status: "reused" as const, job_id: task.job_id };
    }
    if (task) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ogw.analysis.queue.v1', 0))");
      const pending = await client.query<{ total: string }>(
        "SELECT count(*)::text AS total FROM results.analysis_job WHERE status IN ('queued','running')");
      if (Number(pending.rows[0].total) >= businessLimits.queuedAnalysis) return { status: "busy" as const };
    }
    const revision = session.revision + 1;
    const changed = await client.query<{ id: string }>(`
      UPDATE projects.agent_session
      SET revision=$1, summary=$2::jsonb, recent=$3::jsonb, updated_at=now()
      WHERE id=$4 AND project_id=$5 AND kind=$6 AND revision=$7
      RETURNING id
    `, [revision, JSON.stringify(summary), JSON.stringify([...session.recent, turn].slice(-4)),
      session.session_id, session.project_id, kind, session.revision]);
    if (!changed.rowCount) return { status: "conflict" as const };
    if (!task) {
      await appendBusinessAudit(client, { actor: kind, action: "save_chart", outcome: "ok",
        project_id: session.project_id, result_id: summary.result_id, chart_id: summary.chart_id });
      return { status: "saved" as const, revision };
    }
    const job = await client.query<{ id: string }>(`
      INSERT INTO results.analysis_job(project_id,plan,input,data_ref,id)
      VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,COALESCE($5::uuid,gen_random_uuid())) RETURNING id
    `, [session.project_id, JSON.stringify(task.plan), JSON.stringify(task.input), JSON.stringify(task.data_ref), task.job_id ?? null]);
    await client.query("UPDATE projects.agent_session SET summary=$1::jsonb WHERE id=$2", [
      JSON.stringify({ ...summary, job_id: job.rows[0].id }), session.session_id,
    ]);
    await appendBusinessAudit(client, { actor: kind, action: "submit_job", outcome: "queued",
      project_id: session.project_id, result_id: summary.result_id, job_id: job.rows[0].id });
    return { status: "saved" as const, revision, job_id: job.rows[0].id };
  });
}

export async function getAnalysisJob(projectId: string, id: string) {
  return runDataAgentWrite("green_agent_context", async client => {
    const { rows } = await client.query<JobRow>(`
      SELECT id,status,attempt,plan,data_ref,result,error,created_at,updated_at,input->>'analysis_session_id' AS analysis_session_id
      FROM results.analysis_job WHERE id=$1 AND project_id=$2
    `, [id, projectId]);
    const row = rows[0];
    return row && {
      job_id: row.id, status: row.status, attempt: row.attempt, plan: row.plan, data_ref: row.data_ref,
      analysis_session_id: row.analysis_session_id,
      result: row.result, error: row.error, created_at: row.created_at.getTime(), updated_at: row.updated_at.getTime(),
    };
  });
}

export async function readyAnalysisCapabilities() {
  return runDataAgentWrite("green_agent_context", async client => {
    const { rows } = await client.query<{ capability: string }>(`
      SELECT DISTINCT unnest(capabilities) AS capability FROM results.analysis_worker WHERE ready_until > now()
    `);
    return rows.map(row => row.capability);
  });
}
