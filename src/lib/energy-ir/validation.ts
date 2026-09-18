import type { EnergyResult } from "./schema";

export function validateEnergyResult(result: EnergyResult): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!result.summary.trim()) errors.push("summary is required.");
  if (!result.provenance.length) errors.push("at least one provenance record is required.");
  for (const fact of result.facts) {
    if (!fact.label.trim()) errors.push("fact label is required.");
    if (!fact.unit.trim()) errors.push(`unit is required for ${fact.label || "fact"}.`);
    if (typeof fact.value === "number" && !Number.isFinite(fact.value)) errors.push(`${fact.label} is not finite.`);
  }
  for (const source of result.provenance) {
    if (!source.source.trim() || !source.identity || !source.timeRange.trim() || !source.unit.trim() || !source.freshness.trim() || !source.limitation.trim()) {
      errors.push("provenance must include source, identity, timeRange, unit, freshness, and limitation.");
    }
  }
  return { ok: errors.length === 0, errors };
}
