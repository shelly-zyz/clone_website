// @ts-expect-error TS5097 is intentionally isolated to the runtime import used by direct Node tests.
import { compileEnergyIR } from "./compiler.ts";
import type { DashboardQueryContext, EnergyIR, EnergyExecutionPlan, EnergyResult } from "./schema";
// @ts-expect-error TS5097 is intentionally isolated to the runtime import used by direct Node tests.
import { validateEnergyResult } from "./validation.ts";

export type EnergyAgentHistoryItem = { role: "user" | "assistant"; content: string };

export type EnergyPlannerDecision = {
  kind: "query" | "clarification" | "unavailable" | "refused";
  ir: unknown | null;
  message: string | null;
  reasonCode: string | null;
};

export type EnergyPlanner = {
  id: string;
  model: string;
  plan(input: { question: string; context: DashboardQueryContext; history: EnergyAgentHistoryItem[] }): Promise<EnergyPlannerDecision>;
};

export type EnergyAgentResponse = {
  status: "answered" | "clarification" | "unavailable" | "refused";
  message?: string;
  reasonCode?: string;
  ir?: EnergyIR;
  plan?: EnergyExecutionPlan;
  result?: EnergyResult;
  trace: {
    planner: string;
    model: string;
    tool: string | null;
    irOnly: true;
    readOnly: true;
    generatedSql: false;
    validatedBeforeExplanation: boolean;
  };
};

export async function runEnergyDataAgent(
  request: { question: string; context?: DashboardQueryContext; history?: EnergyAgentHistoryItem[] },
  dependencies: { planner: EnergyPlanner; execute: (plan: EnergyExecutionPlan) => Promise<EnergyResult> },
): Promise<EnergyAgentResponse> {
  const baseTrace = {
    planner: dependencies.planner.id,
    model: dependencies.planner.model,
    tool: null,
    irOnly: true as const,
    readOnly: true as const,
    generatedSql: false as const,
    validatedBeforeExplanation: false,
  };
  const decision = await dependencies.planner.plan({
    question: request.question,
    context: request.context ?? {},
    history: request.history ?? [],
  });

  if (decision.kind !== "query") {
    return {
      status: decision.kind,
      message: decision.message ?? fallbackDecisionMessage(decision.kind),
      reasonCode: decision.reasonCode ?? `model-${decision.kind}`,
      trace: baseTrace,
    };
  }

  const compiled = compileEnergyIR(decision.ir);
  if (!compiled.ok) {
    return {
      status: "refused",
      message: "模型提出的EnergyIR未通过只读模式与语义白名单校验，未调用任何工具。",
      reasonCode: "invalid-model-ir",
      trace: baseTrace,
    };
  }

  const result = await dependencies.execute(compiled.plan);
  const validation = validateEnergyResult(result);
  if (!validation.ok) throw new Error(`Energy agent result validation failed: ${validation.errors.join(" ")}`);
  return {
    status: result.status,
    ir: compiled.ir,
    plan: compiled.plan,
    result,
    trace: { ...baseTrace, tool: compiled.plan.tool, validatedBeforeExplanation: true },
  };
}

function fallbackDecisionMessage(kind: Exclude<EnergyPlannerDecision["kind"], "query">) {
  if (kind === "clarification") return "需要补充省份、数据集、技术或时间范围。";
  if (kind === "refused") return "该请求违反只读或数据权限边界。";
  return "该问题所需数据或业务能力当前不可用。";
}
