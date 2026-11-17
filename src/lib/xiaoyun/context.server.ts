import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { createAgentSession, getAgentSession, type AgentKind, type Snapshot } from "@/lib/agent-runtime/store";
import { planSchema } from "@/lib/analysis-agent/contracts";
import type { Topic } from "@/lib/data-agent/contracts";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { createDataProject, createDataSession, readDataSession, resolveDataResult } from "@/lib/data-agent/state.server";
import { chartReferenceSchema, chartSelectionSchema } from "@/lib/visualization-agent/contracts";
import { pendingAnalysisSchema, updatePendingAnalysis, type PendingAnalysis } from "./pending.server";
import type { XiaoyunRequest, XiaoyunSession } from "./contracts";

export const topicNames = { power: "电源地球", meteo: "气象地球", carbon: "碳排放地球" } as const;
export const targets = ["current", "data", "chart", "analysis", "pending_analysis"] as const;
export type Target = (typeof targets)[number];
export type ChartReference = Omit<z.infer<typeof chartReferenceSchema>, "chart_id"> & { chart_id?: string };

const pendingSchema = z.object({
  originalMessage: z.string(), question: z.string(), clarification: z.string(), revision: z.number(),
  baseResultId: z.uuid().optional(), latestVersion: z.boolean(),
  suggestedRange: z.object({ start_date: z.iso.date(), end_date: z.iso.date() }).optional(),
});

export class XiaoyunContextError extends Error {}

async function openTopic(scope: XiaoyunSession, topic: Topic) {
  const data = await readDataSession(scope.project_id, scope.session_id, scope.project_key, true);
  if (data.topic !== topic) throw new DataAgentError("SESSION_CONFLICT", "问数会话与地球专题不一致。");
  const readBusiness = (kind: AgentKind) => {
    const id = scope[kind]?.session_id;
    return id ? getAgentSession(scope.project_id, id, kind) : undefined;
  };
  const [visualization, analysis] = await Promise.all([readBusiness("visualization"), readBusiness("analysis")]);
  const pending = pendingSchema.safeParse(data.xiaoyun_pending).data;
  const analysisPending = pendingAnalysisSchema.safeParse(data.xiaoyun_analysis_pending).data;
  return { scope, data, visualization, analysis, analysisPending, pending: pending?.revision === data.revision ? pending : undefined };
}

type TopicState = Awaited<ReturnType<typeof openTopic>>;

export function chartReference(state: TopicState | undefined, selectedId?: string): ChartReference | undefined {
  const visualization = state?.visualization;
  if (!visualization) return;
  if (selectedId) {
    for (const turn of visualization.recent) {
      const reference = chartReferenceSchema.safeParse(turn.selection).data;
      if (reference?.chart_id === selectedId) return reference;
    }
    throw new XiaoyunContextError("选中的图表引用已失效，请重新选择图表。");
  }
  const { result_id, chart_id, selection } = visualization.summary;
  const parsed = chartSelectionSchema.safeParse(selection).data;
  if (result_id && parsed) return { result_id, chart_id, selection: parsed };
}

export function createTurnContext(input: XiaoyunRequest) {
  const states = new Map<Topic, Promise<TopicState | undefined>>();
  async function get(topic: Topic, create = false) {
    let state = states.get(topic);
    if (!state) {
      const scope = input.context.sessions?.[topic];
      state = scope ? openTopic(scope, topic) : Promise.resolve(undefined);
      states.set(topic, state);
    }
    const current = await state;
    if (current || !create) return current;
    const project = await createDataProject(topic, `小云 · ${topicNames[topic]}`);
    const data = await createDataSession(project.project_id, project.project_key);
    const opened = openTopic({ project_id: project.project_id, project_key: project.project_key, session_id: data.session_id }, topic);
    states.set(topic, opened);
    return opened;
  }

  async function session(state: TopicState, kind: AgentKind): Promise<Snapshot> {
    const existing = state[kind];
    if (existing) return existing;
    const { project_id } = state.scope;
    // A retry may not have received the session ID from the first response.
    const hex = createHash("sha256").update(`xiaoyun-session/${state.scope.session_id}/${kind}`).digest("hex");
    const stableId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const snapshot = await createAgentSession(project_id, kind, stableId);
    state.scope = { ...state.scope, [kind]: { session_id: snapshot.session_id } };
    state[kind] = snapshot;
    return snapshot;
  }

  function pendingAnalysis(state: TopicState) {
    const pending = state.analysisPending;
    return pending && pending.expiresAt > Date.now() && pending.revision === state.data.revision ? pending : undefined;
  }

  async function savePending(state: TopicState, pending: PendingAnalysis | null) {
    await updatePendingAnalysis(state.scope, state.data.revision, state.analysisPending?.token, pending);
    state.analysisPending = pending ?? undefined;
  }

  function selected(topic: Topic) {
    return input.selectedChart?.topic === topic ? input.selectedChart.chart_id : undefined;
  }

  async function describe(topic: Topic) {
    const state = await get(topic);
    if (!state) return { topic };
    const { data, analysis, pending, scope } = state;
    const analysisPending = pendingAnalysis(state);
    const chart = chartReference(state, selected(topic));
    const references = await Promise.all([...new Set([data.last_result_id, chart?.result_id, analysis?.summary.result_id, analysisPending?.resultId])]
      .filter((id): id is string => Boolean(id)).map(async id => {
        const result = await resolveDataResult(scope.project_id, id, scope.project_key);
        return [id, { metric: result.metric.name, region: result.rows[0]?.source_ref.region_name,
          coverage: result.data_ref.time_range, query: result.query, status: result.status }] as const;
      }));
    const describeRef = (id?: string | null) => id ? references.find(([ref]) => ref === id)?.[1] : undefined;
    return { topic, pendingAnalysis: analysisPending && { input: describeRef(analysisPending.resultId),
      plan: analysisPending.plan, clarification: analysisPending.reason }, pending: pending && { originalMessage: pending.originalMessage, clarification: pending.clarification },
      data: describeRef(data.last_result_id),
      chart: chart && { ...chart.selection, selected: Boolean(selected(topic)), input: describeRef(chart.result_id) },
      analysis: analysis?.summary.job_id ? { input: describeRef(analysis.summary.result_id),
        plan: planSchema.safeParse(analysis.summary.selection).data } : undefined };
  }

  return { get, session, selected, describe, pendingAnalysis, savePending };
}
