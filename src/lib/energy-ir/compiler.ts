// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to the runtime import used by direct Node tests.
import { groundEnergyQuestion } from "./grounding.ts";
// @ts-expect-error TS5097 is intentionally isolated to the runtime import used by direct Node tests.
import { routeEnergyIR } from "./router.ts";
// @ts-expect-error TS5097 is intentionally isolated to the runtime import used by direct Node tests.
import { validateEnergyIR, type DashboardQueryContext, type EnergyIR, type EnergyQueryOutcome } from "./schema.ts";

export function compileEnergyQuestion(question: string, context: DashboardQueryContext = {}): EnergyQueryOutcome {
  const grounded = groundEnergyQuestion(question, context);
  if (grounded.status !== "grounded") return grounded;
  const compiled = compileEnergyIR(grounded.ir);
  if (!compiled.ok) return { status: "refused", message: compiled.errors.join(" "), reasonCode: "invalid-ir" };
  return { status: "planned", ir: compiled.ir, plan: compiled.plan };
}

export function compileEnergyIR(value: unknown):
  | { ok: true; ir: EnergyIR; plan: ReturnType<typeof routeEnergyIR> }
  | { ok: false; errors: string[] } {
  const validation = validateEnergyIR(value);
  if (!validation.ok) return validation;
  return { ok: true, ir: validation.value, plan: routeEnergyIR(validation.value) };
}
