import type { QueryRange } from "./contracts";

export type QueryDiagnosis = {
  reason: "no_matching_rows" | "all_values_missing";
  available_range: { start: string; end: string } | null;
  suggested_range: QueryRange | null;
};

export function describeQueryDiagnosis(diagnosis: QueryDiagnosis) {
  const { reason, available_range: available, suggested_range: suggestion } = diagnosis;
  const status = reason === "all_values_missing" ? "所选范围内的记录均为来源缺测。" : "所选范围内没有记录。";
  if (!available) return `${status}该版本下，同一指标及其余筛选条件没有可用观测。`;
  const coverage = `同一版本及其他筛选条件下，有效观测最早为 ${available.start}，最晚为 ${available.end}。`;
  if (!suggestion) return status + coverage;
  const range = suggestion.start_date === suggestion.end_date ? suggestion.start_date : `${suggestion.start_date} 至 ${suggestion.end_date}`;
  return `${status}${coverage}是否改查 ${range}？`;
}
