import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { runDataAgentWrite } from "@/lib/data-agent/database.server";
import { VisualizationError, type FigureRender } from "./contracts";
import type { Evidence, PreparedFigure, Recipe } from "./planner";

const head = "research-figure-v1";
const version = "research-revision-v1";
const snapshot = "research-input-v1";
const preview = "research-preview-v1";
const scope = "green_agent_context";
const revisions = z.array(z.strictObject({ revision: z.number().int(), id: z.uuid(), title: z.string(), at: z.string() })).max(30);
const summary = z.object({ format: z.literal(head), title: z.string(), revisions });
type FigureHead = z.infer<typeof summary>;

export type Artifact = {
  task: string; artifact_id: string; recipe: Recipe; evidence: Evidence; prepared: PreparedFigure; render: FigureRender;
  engine_version: string | null; fingerprint: string;
};

type Revision = Omit<Artifact, "evidence"> & { format: typeof version; input: string };
type Preview = { format: typeof preview; artifact: Artifact };
export type SavedFigure = { figure_id: string; revision: number; title: string; at: string; revisions: FigureHead["revisions"] };

function idFor(key: string) {
  const bytes = createHash("sha256").update(key).digest("hex");
  return [bytes.slice(0, 8), bytes.slice(8, 12), "8" + bytes.slice(13, 16), "8" + bytes.slice(17, 20), bytes.slice(20, 32)].join("-");
}

function requireFound(): never {
  throw new VisualizationError("NOT_FOUND", "在当前项目中找不到这个图件或修订。");
}

export async function readPreview(project: string, id: string) {
  return runDataAgentWrite(scope, async client => {
    const { rows: [record] } = await client.query<{ summary: Preview }>(`
      SELECT summary FROM projects.agent_session
      WHERE project_id=$1 AND kind='visualization' AND summary->>'format'=$2
      AND summary->'artifact'->>'artifact_id'=$3 AND updated_at >= now() - interval '20 minutes'
    `, [project, preview, id]);
    return record?.summary.artifact;
  });
}

export async function cachePreview(project: string, artifact: Artifact, signal: AbortSignal) {
  const payload = JSON.stringify({ format: preview, artifact } satisfies Preview);
  if (Buffer.byteLength(payload) > 9_000_000) throw new VisualizationError("VALIDATION_FAILED", "图件超过预览与版本快照的大小预算。");
  return runDataAgentWrite(scope, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [project + "/research/previews"]);
    const { rows } = await client.query<{ id: string; artifact: string; current: boolean }>(`
      SELECT id, summary->'artifact'->>'artifact_id' AS artifact, updated_at >= now() - interval '20 minutes' AS current
      FROM projects.agent_session WHERE project_id=$1 AND kind='visualization' AND summary->>'format'=$2
      ORDER BY updated_at,id LIMIT 6
    `, [project, preview]);
    const existing = rows.find(row => row.artifact === artifact.artifact_id && row.current);
    signal.throwIfAborted();
    if (existing) {
      const { rows: [record] } = await client.query<{ summary: Preview }>(
        "UPDATE projects.agent_session SET updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING summary", [existing.id, project]);
      if (record.summary.artifact.fingerprint !== artifact.fingerprint) {
        throw new VisualizationError("CONFLICT", "此任务编号已绑定其他绘图配置。");
      }
      return record.summary.artifact;
    }
    const slot = rows.find(row => row.artifact === artifact.artifact_id || !row.current) ?? (rows.length === 6 ? rows[0] : undefined);
    if (slot) {
      await client.query("UPDATE projects.agent_session SET summary=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3", [payload, slot.id, project]);
    } else {
      await client.query("INSERT INTO projects.agent_session (project_id,kind,summary) VALUES ($1,'visualization',$2::jsonb)", [project, payload]);
    }
    return artifact;
  });
}

export async function saveFigure(project: string, artifact: Artifact, figure?: string, expected?: number, signal?: AbortSignal) {
  const id = figure ?? idFor(project + "/research/" + artifact.artifact_id);
  const sourceKey = JSON.stringify(artifact.evidence.map(item => ({ query: item.profile.query, digest: item.profile.digest })));
  const input = idFor(project + "/research/input/" + sourceKey);
  const revisionId = idFor(id + "/research/revision/" + artifact.artifact_id);
  const { evidence, ...details } = artifact;
  const revision: Revision = { ...details, input, format: version };
  // The snapshot contains approved data only and is shared by style-only revisions.
  const bytes = JSON.stringify({ format: snapshot, evidence });
  if (Buffer.byteLength(bytes) > 5_500_000) throw new VisualizationError("VALIDATION_FAILED", "图件输入快照超过保存预算。");
  return runDataAgentWrite(scope, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
    const result = await client.query<{ revision: number; summary: unknown }>(
      "SELECT revision,summary FROM projects.agent_session WHERE id=$1 AND project_id=$2 AND kind='visualization'", [id, project]);
    const present = result.rows[0];
    const current = present ? summary.safeParse(present.summary).data : undefined;
    if (present && !current) return requireFound();
    const replay = current?.revisions.find(item => item.id === revisionId);
    if (replay && current) return { figure_id: id, ...replay, revisions: current.revisions } satisfies SavedFigure;
    if (figure && !present) return requireFound();
    if ((present?.revision ?? undefined) !== expected) {
      throw new VisualizationError("CONFLICT", "图件有新修订，请重新打开再保存。");
    }
    const next = (present?.revision ?? 0) + 1;
    if (next > 30) throw new VisualizationError("CONFLICT", "该图件已保存 30 个修订，请另存为新图件。");
    const title = artifact.prepared.model.title;
    const at = new Date().toISOString();
    const history = [...current?.revisions ?? [], { revision: next, id: revisionId, title, at }];
    const payload = { format: head, title, revisions: history } satisfies FigureHead;
    signal?.throwIfAborted();
    await client.query(`INSERT INTO projects.agent_session (id,project_id,kind,summary)
      VALUES ($1,$2,'visualization',$3::jsonb) ON CONFLICT (id) DO NOTHING`, [input, project, bytes]);
    await client.query(`INSERT INTO projects.agent_session (id,project_id,kind,summary)
      VALUES ($1,$2,'visualization',$3::jsonb)`, [revisionId, project, JSON.stringify(revision)]);
    if (present) {
      await client.query(`UPDATE projects.agent_session SET revision=$1,summary=$2::jsonb,updated_at=now()
        WHERE id=$3 AND project_id=$4`, [next, JSON.stringify(payload), id, project]);
    } else {
      await client.query(`INSERT INTO projects.agent_session (id,project_id,kind,revision,summary)
        VALUES ($1,$2,'visualization',$3,$4::jsonb)`, [id, project, next, JSON.stringify(payload)]);
    }
    return { figure_id: id, title, at, revision: next, revisions: history } satisfies SavedFigure;
  });
}

export async function listFigures(project: string) {
  return runDataAgentWrite(scope, async client => {
    const { rows } = await client.query<{ figure_id: string; title: string; revision: number; at: Date }>(
      `SELECT id AS figure_id,summary->>'title' AS title,revision,updated_at AS at
      FROM projects.agent_session WHERE project_id=$1 AND kind='visualization' AND summary->>'format'=$2
      ORDER BY updated_at DESC,id LIMIT 40`, [project, head]);
    return rows.map(row => ({ ...row, at: row.at.toISOString() }));
  });
}

export async function readFigure(project: string, id: string, requested?: number) {
  return runDataAgentWrite(scope, async client => {
    const row = await client.query<{ summary: unknown }>(
      "SELECT summary FROM projects.agent_session WHERE id=$1 AND project_id=$2 AND kind='visualization'", [id, project]);
    const current = summary.safeParse(row.rows[0]?.summary).data;
    const target = requested === undefined ? current?.revisions.at(-1) : current?.revisions.find(item => item.revision === requested);
    if (!target || !current) return requireFound();
    const { rows: [record] } = await client.query<{ summary: Revision; source: { format: string; evidence: Evidence } }>(
      `SELECT r.summary,i.summary AS source
       FROM projects.agent_session r JOIN projects.agent_session i
       ON i.id=(r.summary->>'input')::uuid AND i.project_id=r.project_id AND i.kind='visualization' AND i.summary->>'format'=$4
       WHERE r.id=$1 AND r.project_id=$2 AND r.kind='visualization' AND r.summary->>'format'=$3`, [target.id, project, version, snapshot]);
    if (!record) return requireFound();
    const { format: _format, input: _input, ...stored } = record.summary;
    void _format; void _input;
    return { artifact: { ...stored, evidence: record.source.evidence } satisfies Artifact,
      saved: { figure_id: id, revision: target.revision, title: target.title, at: target.at, revisions: current.revisions } satisfies SavedFigure };
  });
}
