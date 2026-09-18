import { NextResponse } from "next/server";
import { runEnergyDataAgent, type EnergyAgentHistoryItem } from "@/lib/energy-ir/agent.server";
import { executeEnergyPlan } from "@/lib/energy-ir/executor.server";
import { createConfiguredEnergyPlanner } from "@/lib/energy-ir/openai-planner.server";
import { reviewedRecipes } from "@/lib/energy-ir/recipes";
import { productionSemanticCatalog, SEMANTIC_CATALOG_VERSION } from "@/lib/energy-ir/semantic-catalog";
import type { DashboardQueryContext } from "@/lib/energy-ir/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { config } = createConfiguredEnergyPlanner();
  return NextResponse.json({
    schemaVersion: 1,
    semanticCatalogVersion: SEMANTIC_CATALOG_VERSION,
    policy: { irOnly: true, readOnly: true, freeSql: false, writes: false },
    agent: config,
    catalog: productionSemanticCatalog,
    recipes: reviewedRecipes,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 }); }
  if (!isRecord(body) || typeof body.question !== "string" || !body.question.trim() || body.question.length > 300) {
    return NextResponse.json({ error: "question must contain 1-300 characters." }, { status: 400 });
  }
  const context = sanitizeContext(body.context);
  const history = sanitizeHistory(body.history);
  const { config, planner } = createConfiguredEnergyPlanner();
  if (!planner) {
    return NextResponse.json({
      schemaVersion: 1,
      question: body.question,
      status: "unavailable",
      message: config.reason,
      reasonCode: "agent-unconfigured",
      trace: { planner: null, model: null, tool: null, irOnly: true, readOnly: true, generatedSql: false, validatedBeforeExplanation: false },
    }, { status: 503 });
  }

  try {
    const response = await runEnergyDataAgent({ question: body.question, context, history }, { planner, execute: executeEnergyPlan });
    return NextResponse.json({
      schemaVersion: 1,
      question: body.question,
      ...response,
      semanticCatalogVersion: SEMANTIC_CATALOG_VERSION,
    });
  } catch (error) {
    console.error("EnergyDataAgent execution failed.", error);
    return NextResponse.json({
      schemaVersion: 1,
      question: body.question,
      status: "unavailable",
      message: "受控只读工具当前不可用，未生成替代答案。",
      reasonCode: "tool-unavailable",
      trace: { planner: planner.id, model: planner.model, tool: null, irOnly: true, readOnly: true, generatedSql: false, validatedBeforeExplanation: false },
    }, { status: 503 });
  }
}

function sanitizeContext(value: unknown): DashboardQueryContext {
  if (!isRecord(value)) return {};
  const result: DashboardQueryContext = {};
  for (const key of ["selectedProvince", "selectedLayer", "selectedFacility", "timeMode"] as const) {
    if (typeof value[key] === "string" && value[key].length <= 100) result[key] = value[key];
  }
  return result;
}

function sanitizeHistory(value: unknown): EnergyAgentHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).flatMap((item) => {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return [];
    return [{ role: item.role, content: item.content.slice(0, 600) }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
