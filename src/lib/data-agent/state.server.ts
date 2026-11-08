import "server-only";

import { appendBusinessAudit, withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { createHash, randomBytes } from "node:crypto";
import { dataQuerySchema, type Topic, type SessionScope } from "./contracts";
import { DataAgentError, runDataAgentWrite } from "./database.server";
import { askDataAgent } from "./pi.server";
import type { queryData } from "./query.server";

const contextWriter = "green_agent_context";
const digest = (key: string) => createHash("sha256").update(key).digest("hex");

function projectHash(key: string | null) {
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new DataAgentError("PROJECT_NOT_FOUND", "无法访问此数据项目。");
  }
  return digest(key);
}

export async function assertDataProject(projectId: string, key: string | null) {
  const hash = projectHash(key);
  await runDataAgentWrite(contextWriter, async (client) => {
    const { rowCount } = await client.query(
      "SELECT 1 FROM projects.data_project WHERE id = $1 AND access_hash = $2", [projectId, hash]);
    if (!rowCount) throw new DataAgentError("PROJECT_NOT_FOUND", "无法访问此数据项目。");
  });
}

export async function createDataProject(topic: Topic, name: string) {
  const projectKey = randomBytes(32).toString("base64url");
  return runDataAgentWrite(contextWriter, async (client) => {
    const { rows: [project] } = await client.query<{ id: string }>(
      "INSERT INTO projects.data_project (topic, name, access_hash) VALUES ($1,$2,$3) RETURNING id",
      [topic, name, digest(projectKey)]);
    return { project_id: project.id, project_key: projectKey, topic, name };
  });
}

export async function createDataSession(projectId: string, key: string | null) {
  const hash = projectHash(key);
  return runDataAgentWrite(contextWriter, async (client) => {
    const { rows: [session] } = await client.query<{ id: string; revision: number }>(`
      INSERT INTO projects.data_session (project_id)
      SELECT id FROM projects.data_project WHERE id = $1 AND access_hash = $2
      RETURNING id, revision`, [projectId, hash]);
    if (!session) throw new DataAgentError("PROJECT_NOT_FOUND", "无法访问此数据项目。");
    return { session_id: session.id, project_id: projectId, revision: session.revision };
  });
}

export async function readDataSession(projectId: string, sessionId: string, key: string | null, includePending = false) {
  const hash = projectHash(key);
  return runDataAgentWrite(contextWriter, async (client) => {
    const { rows: [session] } = await client.query<{ topic: Topic; revision: number; summary: unknown; last_result_id: string | null; xiaoyun_pending?: unknown; xiaoyun_analysis_pending?: unknown }>(`
      SELECT p.topic, s.revision, s.summary${includePending ? ", s.xiaoyun_pending, s.xiaoyun_analysis_pending" : ""}, (
        SELECT t.result_id FROM projects.data_session_turn t
        WHERE t.session_id = s.id AND t.result_id IS NOT NULL ORDER BY t.revision DESC LIMIT 1
      ) AS last_result_id FROM projects.data_session s
      JOIN projects.data_project p ON p.id = s.project_id
      WHERE p.id = $1 AND s.id = $2 AND p.access_hash = $3`, [projectId, sessionId, hash]);
    if (!session) throw new DataAgentError("PROJECT_NOT_FOUND", "无法访问此问数会话。");
    const turns = await client.query<{ question: string; status: string; revision: number; result_id: string | null }>(`
      SELECT question, status, revision, result_id FROM projects.data_session_turn
      WHERE session_id = $1 AND revision <= $2 ORDER BY revision DESC LIMIT 4`, [sessionId, session.revision]);
    return { ...session, turns: turns.rows.reverse(), project_id: projectId, session_id: sessionId };
  });
}

export async function resolveDataResult(projectId: string, resultId: string, key: string | null) {
  const hash = projectHash(key);
  return runDataAgentWrite(contextWriter, async (client) => {
    const { rows: [result] } = await client.query<{ response: Awaited<ReturnType<typeof queryData>> }>(`
      SELECT r.response FROM results.data_query_result r JOIN projects.data_project p ON p.id = r.project_id
      WHERE p.id = $1 AND r.id = $2 AND p.access_hash = $3`, [projectId, resultId, hash]);
    if (!result) throw new DataAgentError("PROJECT_NOT_FOUND", "无法访问此查询结果。");
    return result.response;
  });
}

export async function askDataSession(
  topic: Topic, question: string, scope: Omit<SessionScope, "revision"> & { revision?: number }, key: string | null, signal: AbortSignal,
  xiaoyun?: { originalMessage: string; baseResultId?: string; latestVersion: boolean; requestId?: string; resume?: boolean; resumedFromPending?: boolean },
) {
  return withBusinessAction("data", "session_query", () => executeDataSession(topic, question, scope, key, signal, xiaoyun), scope.project_id);
}

async function executeDataSession(topic: Topic, question: string, scope: Omit<SessionScope, "revision"> & { revision?: number },
  key: string | null, signal: AbortSignal, xiaoyun: Parameters<typeof askDataSession>[5]) {
  const session = await readDataSession(scope.project_id, scope.session_id, key);
  if (session.topic === topic && xiaoyun?.requestId) {
    const prior = await runDataAgentWrite(contextWriter, async client => {
      const { rows: [turn] } = await client.query<{ revision: number; status: string; result_id: string | null }>(
        "SELECT revision,status,result_id FROM projects.data_session_turn WHERE session_id=$1 AND xiaoyun_request_id=$2",
        [scope.session_id, xiaoyun.requestId]);
      return turn;
    });
    if (prior) {
      if (prior.revision !== session.revision) throw new DataAgentError("SESSION_CONFLICT", "重试请求对应的会话已有更新。");
      if (prior.result_id) {
        const result = await resolveDataResult(scope.project_id, prior.result_id, key);
        return { ...result, revision: prior.revision, result_id: prior.result_id };
      }
      const saved = await readDataSession(scope.project_id, scope.session_id, key, true);
      const pending = saved.xiaoyun_pending as { clarification?: string } | null;
      return { status: "needs_clarification" as const, revision: prior.revision, result_id: null,
        issue: pending ? "clarify" as const : "unsupported" as const, message: pending?.clarification ?? "此查询超出当前数据范围。" };
    }
  }
  if (xiaoyun?.resume && !xiaoyun.resumedFromPending) {
    throw new DataAgentError("SESSION_CONFLICT", "当前没有待澄清的查询。");
  }
  if (session.topic !== topic || (scope.revision !== undefined && session.revision !== scope.revision)) {
    throw new DataAgentError("SESSION_CONFLICT", "会话专题或修订号不匹配，请重新读取会话。");
  }
  const base = xiaoyun?.baseResultId ? await resolveDataResult(scope.project_id, xiaoyun.baseResultId, key) : undefined;
  const previous = dataQuerySchema.safeParse(base ? { ...base.query, metric_code: base.metric.metric_code } : session.summary);
  if (base && (!previous.success || previous.data.topic !== topic)) {
    throw new DataAgentError("SESSION_CONFLICT", "原查询结果与当前专题不一致。");
  }
  const answer = await askDataAgent(topic, question, signal, {
    previous: previous.success && (!xiaoyun || base) ? previous.data : undefined,
    boundBase: base && xiaoyun ? { latestVersion: xiaoyun.latestVersion } : undefined,
    recent: session.turns.map(({ question, status }) => ({ question, status })),
  });
  signal.throwIfAborted();
  return runDataAgentWrite(contextWriter, async (client) => {
    const lookup = await client.query<{ revision: number }>(`
      UPDATE projects.data_session SET revision = revision + 1, summary = COALESCE($1::jsonb, summary)
      WHERE id = $2 AND project_id = $3 AND revision = $4 RETURNING revision`,
    ["query" in answer ? JSON.stringify({ ...answer.query, metric_code: answer.metric.metric_code }) : null,
      scope.session_id, scope.project_id, session.revision]);
    const revision = lookup.rows[0]?.revision;
    if (revision === undefined) throw new DataAgentError("SESSION_CONFLICT", "会话已有新消息，请重新读取会话。");
    if (xiaoyun) {
      const pending = answer.status === "needs_clarification" && answer.issue === "clarify"
        ? { originalMessage: xiaoyun.originalMessage, baseResultId: xiaoyun.baseResultId, latestVersion: xiaoyun.latestVersion, question, clarification: answer.message, revision } : null;
      await client.query("UPDATE projects.data_session SET xiaoyun_pending=$1::jsonb WHERE id=$2",
        [pending ? JSON.stringify(pending) : null, scope.session_id]);
    }
    let resultId: string | null = null;
    if ("data_ref" in answer) {
      const { data_ref, metric, query, rows, status } = answer;
      const payload = { data_ref, metric, query, rows, status };
      await client.query(`
        INSERT INTO results.data_query_result (project_id, query_hash, response) VALUES ($1,$2,$3)
        ON CONFLICT (project_id, query_hash) DO NOTHING`, [scope.project_id, data_ref.query_hash, JSON.stringify(payload)]);
      const { rows: [result] } = await client.query<{ id: string }>(
        "SELECT id FROM results.data_query_result WHERE project_id = $1 AND query_hash = $2", [scope.project_id, data_ref.query_hash]);
      resultId = result.id;
    }
    const fields = [scope.session_id, revision, question, answer.status, resultId, JSON.stringify(answer.trace)];
    if (xiaoyun?.requestId) {
      await client.query(`
        INSERT INTO projects.data_session_turn (session_id, revision, question, status, result_id, trace, xiaoyun_request_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [...fields, xiaoyun.requestId]);
    } else {
      await client.query(`
        INSERT INTO projects.data_session_turn (session_id, revision, question, status, result_id, trace)
        VALUES ($1,$2,$3,$4,$5,$6)`, fields);
    }
    await appendBusinessAudit(client, { actor: "data", action: "save_query", outcome: answer.status,
      project_id: scope.project_id, result_id: resultId ?? undefined });
    return { ...answer, revision, result_id: resultId };
  });
}
