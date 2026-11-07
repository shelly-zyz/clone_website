import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AgentKind = "analysis" | "visualization";
type Turn = { instruction: string; status: string; selection?: unknown };
type Context = { result_id?: string; selection?: unknown; job_id?: string };
type Snapshot = { session_id: string; project_id: string; revision: number; summary: Context; recent: Turn[] };
type Job = {
  id: string; project_id: string; status: "queued" | "running" | "succeeded" | "failed";
  attempt: number; plan: string; input: string; data_ref: string; result: string | null; error: string | null;
  created_at: number; updated_at: number;
};

let db: DatabaseSync | undefined;

function database() {
  if (db) return db;
  const configuredPath = process.env.OGW_AGENT_STATE_DB?.trim();
  const path = configuredPath ? resolve(configuredPath) : join(homedir(), ".local/share/opengridworks/agent-state.sqlite");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    connection.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS agent_session (
        session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '{}', recent TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS analysis_job (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        plan TEXT NOT NULL, input TEXT NOT NULL, data_ref TEXT NOT NULL, result TEXT, error TEXT,
        attempt INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analysis_queue ON analysis_job (status, created_at);
    `);
    db = connection;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

function transaction<T>(run: (db: DatabaseSync) => T): T {
  const connection = database();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = run(connection);
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function createAgentSession(projectId: string, kind: AgentKind) {
  const id = randomUUID();
  database().prepare("INSERT INTO agent_session(session_id,project_id,kind) VALUES(?,?,?)").run(id, projectId, kind);
  return { session_id: id, project_id: projectId, revision: 0 };
}

export function getAgentSession(projectId: string, id: string, kind: AgentKind): Snapshot | undefined {
  const row = database().prepare(
    "SELECT revision,summary,recent FROM agent_session WHERE session_id=? AND project_id=? AND kind=?",
  ).get(id, projectId, kind);
  return row ? {
    session_id: id, project_id: projectId, revision: Number(row.revision),
    summary: JSON.parse(String(row.summary)), recent: JSON.parse(String(row.recent)),
  } : undefined;
}

type Task = { plan: unknown; input: unknown; data_ref: unknown };

export function advanceAgentSession(
  session: Snapshot, kind: AgentKind, summary: Context, turn: Turn, task?: Task,
) {
  return transaction(connection => {
    const jobId = task ? randomUUID() : undefined;
    if (task) {
      const pending = connection.prepare("SELECT count(*) AS total FROM analysis_job WHERE status IN ('queued','running')").get();
      if (Number(pending?.total) >= 32) return { status: "busy" as const };
    }
    const revision = session.revision + 1;
    const changed = connection.prepare(`
      UPDATE agent_session SET revision=?, summary=?, recent=?
      WHERE session_id=? AND project_id=? AND kind=? AND revision=?
    `).run(revision, JSON.stringify({ ...summary, ...(jobId ? { job_id: jobId } : {}) }),
      JSON.stringify([...session.recent, turn].slice(-4)), session.session_id, session.project_id, kind, session.revision);
    if (!changed.changes) return { status: "conflict" as const };
    if (task && jobId) {
      const now = Date.now();
      connection.prepare(`
        INSERT INTO analysis_job(id,project_id,plan,input,data_ref,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      `).run(jobId, session.project_id, JSON.stringify(task.plan), JSON.stringify(task.input),
        JSON.stringify(task.data_ref), now, now);
    }
    return { status: "saved" as const, revision, job_id: jobId };
  });
}

export function getAnalysisJob(projectId: string, id: string) {
  const row = database().prepare("SELECT * FROM analysis_job WHERE id=? AND project_id=?").get(id, projectId) as Job | undefined;
  if (!row) return undefined;
  return {
    job_id: row.id, status: row.status, attempt: row.attempt, plan: JSON.parse(row.plan), data_ref: JSON.parse(row.data_ref),
    result: row.result ? JSON.parse(row.result) : null, error: row.error, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function claimAnalysisJob() {
  return transaction(connection => {
    const now = Date.now();
    connection.prepare(`
      UPDATE analysis_job SET status='failed',error='任务租约过期',updated_at=?
      WHERE status='running' AND lease_until<=? AND attempt>=2
    `).run(now, now);
    const row = connection.prepare(`
      SELECT * FROM analysis_job WHERE status='queued' OR (status='running' AND lease_until<=? AND attempt<2)
      ORDER BY created_at LIMIT 1
    `).get(now) as Job | undefined;
    if (!row) return undefined;
    const lease = randomUUID();
    connection.prepare(`
      UPDATE analysis_job SET status='running',attempt=attempt+1,lease=?,lease_until=?,updated_at=? WHERE id=?
    `).run(lease, now + 190_000, now, row.id);
    return { id: row.id, lease, plan: JSON.parse(row.plan), input: JSON.parse(row.input) };
  });
}

export function finishAnalysisJob(id: string, lease: string, output: { result: unknown } | { error: string }) {
  const success = "result" in output;
  database().prepare(`
    UPDATE analysis_job SET status=?,result=?,error=?,updated_at=?,lease=NULL,lease_until=NULL
    WHERE id=? AND lease=? AND status='running'
  `).run(success ? "succeeded" : "failed", success ? JSON.stringify(output.result) : null,
    success ? null : output.error, Date.now(), id, lease);
}
