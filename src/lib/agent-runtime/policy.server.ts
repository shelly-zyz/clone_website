import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { DataAgentError } from "@/lib/data-agent/database.server";

export const agentPolicy = {
  xiaoyun: { concurrency: 4, time: 55_000, turns: 7, tools: 9,
    allow: ["load_skill", "query_data", "inspect_data", "render_chart", "render_dashboard", "submit_analysis", "get_analysis", "get_sources", "list_available_datasets", "utc_now"] },
  data: { concurrency: 2, time: 25_000, turns: 4, tools: 5,
    allow: ["search_semantic_catalog", "query_approved_metric", "report_query_gap"] },
  chartPlan: { concurrency: 4, time: 10_000, turns: 1, tools: 1, allow: ["select_chart"] },
  analysisPlan: { concurrency: 4, time: 10_000, turns: 1, tools: 1, allow: ["plan_analysis"] },
  map: { concurrency: 2, time: 25_000, turns: 3, tools: 3, allow: ["utc_now", "list_available_datasets"] },
} as const;
export const businessLimits = { queryAttempts: 3, queuedAnalysis: 32, chartConcurrency: 3 } as const;
export type AgentGuard = ReturnType<typeof makeGuard>;
type AgentRole = keyof typeof agentPolicy;
const runLimits = { tools: 14, turns: 11 } as const;
type Budget = { id: string; tools: number; turns: number };
const run = new AsyncLocalStorage<Budget>();
const active = new Map<AgentRole, number>();

type AuditFields = {
  run_id?: string; span_id?: string; parent_span_id?: string; actor: string; action: string;
  outcome: string; elapsed_ms?: number; project_id?: string; result_id?: string; job_id?: string;
  chart_id?: string; batch_id?: string; reason?: string; input_tokens?: number; output_tokens?: number;
};

// Emit only classified fields. Never include prompts, raw errors, credentials or rows.
export function currentAuditRunId() { return run.getStore()?.id; }

function auditRecord(event: AuditFields) {
  return { schema: "ogw.agent.audit.v1", time: new Date().toISOString(), ...event,
    run_id: event.run_id ?? currentAuditRunId() ?? randomUUID() };
}

export function auditBusiness(event: AuditFields) {
  console.info(JSON.stringify(auditRecord(event)));
}

export async function appendBusinessAudit(client: PoolClient, event: AuditFields) {
  const record = auditRecord(event);
  await client.query("INSERT INTO projects.agent_audit_event(event) VALUES($1::jsonb)", [JSON.stringify(record)]);
}

export function auditOutcome(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = String(record.status ?? record.code ?? "");
  return {
    outcome: ["ok", "empty", "missing", "clarify", "needs_clarification", "unsupported", "needs_input", "needs_skill",
      "queued", "running", "succeeded", "failed", "reused", "conflict", "BUSY", "PROJECT_NOT_FOUND",
      "SESSION_CONFLICT", "NOT_CONFIGURED", "VERSION_NOT_FOUND", "INVALID_FILTER", "INVALID_METRIC", "INVALID_SERIES",
      "INVALID_REGION", "CATALOG_REQUIRED", "METRIC_REQUIRED", "unavailable"].includes(status) ? status : "ok",
    ...Object.fromEntries(["result_id", "job_id", "chart_id"].flatMap(key => {
      const id = record[key];
      return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? [[key, id]] : [];
    })),
  };
}

const scope = new AsyncLocalStorage<string>();
export async function withAgentRun<T>(actor: AgentRole, parentSignal: AbortSignal, execute: (guard: AgentGuard) => Promise<T>, requestId?: string): Promise<T> {
  const parent = run.getStore();
  const budget = parent ?? { id: requestId ?? randomUUID(), ...runLimits };
  const parentSpan = scope.getStore();
  const span = randomUUID();
  const start = Date.now();
  const log = (fields: Omit<AuditFields, "actor">) => auditBusiness({ actor, run_id: budget.id, span_id: span,
    parent_span_id: parentSpan, ...fields });
  const used = active.get(actor) ?? 0;
  if (used >= agentPolicy[actor].concurrency) {
    log({ action: "run", outcome: "blocked", reason: "concurrency" });
    throw new DataAgentError("BUSY", "智能体正在处理其他请求，请稍后再试。");
  }
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(agentPolicy[actor].time)]);
  signal.throwIfAborted();
  active.set(actor, used + 1);
  try {
    const result = await run.run(budget, () => scope.run(span, () => execute(makeGuard(actor, budget, signal, log))));
    log({ action: "run", ...auditOutcome(result), elapsed_ms: Date.now() - start });
    return result;
  } catch (error) {
    log({ action: "run", ...(signal.aborted ? { outcome: "aborted" } : error instanceof DataAgentError ? auditOutcome(error) : { outcome: "failed" }),
      elapsed_ms: Date.now() - start });
    throw error;
  } finally {
    active.set(actor, (active.get(actor) ?? 1) - 1);
  }
}

function makeGuard(actor: AgentRole, budget: Budget, signal: AbortSignal, log: (event: Omit<AuditFields, "actor">) => void) {
  const limit = agentPolicy[actor];
  let tools = 0;
  let turns = 0;
  return {
    signal,
    tool(name: string, available = true) {
      const allowed = (limit.allow as readonly string[]).includes(name);
      if (!allowed || !available || signal.aborted || tools >= limit.tools || budget.tools <= 0) {
        log({ action: "tool", outcome: "blocked", reason: !allowed ? "capability" : !available ? "workflow" : signal.aborted ? "timeout" : "budget" });
        return { block: true as const, reason: "此动作不在允许范围内，或本轮已结束或达到调用上限。", terminate: true };
      }
      tools++;
      budget.tools--;
    },
    model() {
      signal.throwIfAborted();
      if (turns >= limit.turns || budget.turns <= 0) throw new DataAgentError("BUSY", "本轮已达到模型调用上限。");
      turns++;
      budget.turns--;
    },
    done: () => turns >= limit.turns || budget.turns <= 0,
    record(name: string, start: number, value: unknown) {
      // Names are registered by the service, not read from model text.
      log({ action: name, ...auditOutcome(value), elapsed_ms: Date.now() - start });
    },
    usage(message: { usage: { input: number; output: number } }) {
      log({ action: "model", outcome: "completed", input_tokens: message.usage.input, output_tokens: message.usage.output });
    },
  };
}

export async function withBusinessAction<T>(actor: string, action: string, execute: () => Promise<T>, project_id?: string): Promise<T> {
  const parent = run.getStore();
  const budget = parent ?? { id: randomUUID(), ...runLimits };
  const start = Date.now();
  const base = { actor, action, project_id, run_id: budget.id, parent_span_id: scope.getStore() };
  try {
    const result = await run.run(budget, execute);
    auditBusiness({ ...base, ...auditOutcome(result), elapsed_ms: Date.now() - start });
    return result;
  } catch (error) {
    auditBusiness({ ...base, ...(error instanceof DataAgentError ? auditOutcome(error) : { outcome: "failed" }),
      elapsed_ms: Date.now() - start });
    throw error;
  }
}
