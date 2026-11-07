import "server-only";

import type { EChartsOption } from "echarts";
import type { z } from "zod";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { resolveDataResult } from "@/lib/data-agent/state.server";
import type { visualizationRequestSchema } from "./contracts";
import { chartTools, generateChartOption } from "./echarts-mcp.server";
import { selectChart } from "./pi.server";

let active = 0;

export async function visualizeResult(
  request: z.infer<typeof visualizationRequestSchema>, projectKey: string | null, signal: AbortSignal,
) {
  if (active >= 2) throw new DataAgentError("BUSY", "可视化服务正在处理其他请求，请稍后重试。");
  active += 1;
  try {
    const result = await resolveDataResult(request.project_id, request.result_id, projectKey);
    signal.throwIfAborted();
    const { metric, rows } = result;
    const monthly = metric.time_grain === "month";
    const forecast = metric.time_grain === "forecast_frame";
    const timeAxis = monthly ? "月份" : forecast ? "有效时刻（UTC）" : "日期";
    const points = rows.map(({ time_start, value }) => ({
      label: monthly ? time_start.slice(0, 7) : forecast ? time_start.slice(0, 16).replace("T", " ") : time_start.slice(0, 10),
      value: value === null ? null : Number(value),
    }));
    const numeric = points.flatMap(({ label, value }) => value === null ? [] : [{ label, value }]);
    if (numeric.length === 0) return { status: "empty" as const, error: "该查询结果没有可绘制的观测值。" };
    if (numeric.some(({ value }) => !Number.isFinite(value))) throw new Error("Invalid chart value in a saved data result");

    const chart = request.action === "render" ? request.chart
      : await selectChart(request.instruction, { name: metric.name, time_grain: metric.time_grain }, points.length, signal);
    if (!chart) return { status: "unsupported" as const, error: "当前模板支持对已保存结果绘制折线图或柱状图。" };
    const location = rows[0]?.source_ref.region_name;
    const title = [typeof location === "string" ? location : "", metric.name].filter(Boolean).join(" · ");
    const values = await generateChartOption(chart, title, metric.unit, timeAxis, numeric, signal);
    // MCP accepts numbers only. Restore the original positions of missing observations.
    let index = 0;
    const series = points.map(({ value }) => value === null ? null : values[index++]);
    const options: EChartsOption = {
      animation: false,
      title: { text: title, left: "center" },
      grid: { left: 92, right: 40, bottom: 70, top: 64 },
      tooltip: { trigger: "axis", renderMode: "richText" },
      xAxis: { type: "category", data: points.map(({ label }) => label), name: timeAxis, nameLocation: "middle", nameGap: 36 },
      yAxis: { type: "value", name: metric.unit },
      series: [chart === "line"
        ? { type: "line", data: series, connectNulls: false }
        : { type: "bar", data: series, barMaxWidth: 40 }],
    };
    return {
      status: "ok" as const, mode: request.action === "ask" ? "pi" : "direct",
      renderer: "mcp-echarts", tool: chartTools[chart], result_id: request.result_id,
      template_id: `echarts.${chart}.time-series`, template_version: "1",
      data_ref: result.data_ref, field_mapping: { x: "time_start", y: "value" }, options, events: [],
    };
  } finally {
    active -= 1;
  }
}
