import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

let db;

function database() {
  if (db) return db;
  const configured = process.env.OGW_AGENT_STATE_DB?.trim();
  const path = configured ? resolve(configured) : join(homedir(), ".local/share/opengridworks/agent-state.sqlite");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    connection.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
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

function transaction(run) {
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
    `).get(now);
    if (!row) return undefined;
    const lease = randomUUID();
    connection.prepare(`
      UPDATE analysis_job SET status='running',attempt=attempt+1,lease=?,lease_until=?,updated_at=? WHERE id=?
    `).run(lease, now + 190_000, now, row.id);
    return { id: row.id, lease, plan: JSON.parse(row.plan), input: JSON.parse(row.input) };
  });
}

export function finishAnalysisJob(id, lease, output) {
  const success = "result" in output;
  database().prepare(`
    UPDATE analysis_job SET status=?,result=?,error=?,updated_at=?,lease=NULL,lease_until=NULL
    WHERE id=? AND lease=? AND status='running'
  `).run(success ? "succeeded" : "failed", success ? JSON.stringify(output.result) : null,
    success ? null : output.error, Date.now(), id, lease);
}
