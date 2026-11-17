import "server-only";

import { getAnalysisJob } from "@/lib/agent-runtime/store";
import { analysisResultSchema } from "@/lib/agent-runtime/analysis-result";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { assertDataProject, resolveDataResult } from "@/lib/data-agent/state.server";
import type { ExportReference } from "./assistant-artifacts";

type Cell = string | number | null | undefined;

function cell(value: Cell) {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  const text = /^[\t\r\n]|^[\s\uFEFF]*[=+\-@]/.test(value) && !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) ? "'" + value : value;
  return '"' + text.replaceAll('"', '""') + '"';
}

function csv(rows: Cell[][]) {
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function exportResult(reference: ExportReference, projectId: string, key: string | null) {
  if (reference.kind === "analysis") {
    await assertDataProject(projectId, key);
    const job = await getAnalysisJob(projectId, reference.id);
    if (job?.status !== "succeeded") throw new DataAgentError("PROJECT_NOT_FOUND", "无法读取已完成的分析结果。");
    const result = analysisResultSchema.parse(job.result);
    return { contents: JSON.stringify({ project_id: projectId, job_id: job.job_id, data_ref: job.data_ref, plan: job.plan, result }, null, 2),
      type: "application/json", extension: "json" };
  }
  const result = await resolveDataResult(projectId, reference.id, key);
  if (result.query.topic !== reference.topic) throw new DataAgentError("PROJECT_NOT_FOUND", "无法访问此查询结果。");
  const { rows, metric, query, data_ref } = result;
  if (reference.format === "json") return {
    contents: JSON.stringify({ project_id: projectId, result_id: reference.id, data_ref, metric, query, rows }, null, 2),
    type: "application/json", extension: "json",
  };
  return { contents: csv([
    ["时间（UTC）", "起报时间（UTC）", "地区", "地区代码", "序列", "指标", "数值", "单位", "质量标记",
      "数据集", "发布版本", "查询哈希", "结果 ID", "来源", "原文链接", "查询筛选", "结果质量"],
    ...rows.map(row => [row.time_start, row.issue_time, String(row.source_ref.region_name ?? ""), row.entity_code, row.series_code,
      metric.name, row.value, metric.unit, row.quality_flag, data_ref.dataset_id, data_ref.version, data_ref.query_hash,
      reference.id, metric.source_name, typeof row.source_ref.url === "string" && row.source_ref.url.startsWith("https://") ? row.source_ref.url : "",
      JSON.stringify(query), JSON.stringify(data_ref.quality)]),
  ]), type: "text/csv;charset=utf-8", extension: "csv" };
}
