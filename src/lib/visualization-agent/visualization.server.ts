import "server-only";

import type { G2Spec } from "@antv/g2";
import type { IBarChartSpec, ILineChartSpec } from "@visactor/vchart";
import type { EChartsOption } from "echarts";
import { z } from "zod";
import { selectWithPi } from "@/lib/agent-runtime/pi-tool.server";
import { advanceAgentSession, createAgentSession, getAgentSession } from "@/lib/agent-runtime/store";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { assertDataProject, resolveDataResult } from "@/lib/data-agent/state.server";
import { chartBackends, chartTypes, type ChartBackend, type ChartType, type visualizationRequestSchema } from "./contracts";
import { chartTools, generateChartOption } from "./echarts-mcp.server";
import { powerScene } from "./scene.server";

type Request = z.infer<typeof visualizationRequestSchema>;
type Point = { label: string; value: number | null };
const choiceSchema = z.strictObject({ chart: z.enum([...chartTypes, "unsupported"]), renderer: z.enum(chartBackends).optional() });
const settingsSchema = z.strictObject({ chart: z.enum(chartTypes), renderer: z.enum(chartBackends) });
const pointsSchema = z.array(z.strictObject({ label: z.string().min(1), value: z.number().nullable() })).min(1).max(120);
let active = 0;

async function renderOptions(
  chart: ChartType, renderer: ChartBackend, points: Point[], title: string, unit: string, axis: string, signal: AbortSignal,
) {
  if (renderer === "vchart") {
    const options = {
      type: chart, data: [{ id: "series", values: points }], xField: "label", yField: "value",
      title: { visible: true, text: title }, invalidType: "break",
      axes: [{ orient: "bottom", title: { visible: true, text: axis } }, { orient: "left", title: { visible: true, text: unit } }],
    } satisfies IBarChartSpec | ILineChartSpec;
    return { renderer: "vchart" as const, tool: "render_vchart", options };
  }
  if (renderer === "antv") {
    const options: G2Spec = {
      type: chart === "line" ? "line" : "interval", title, data: points,
      encode: { x: "label", y: "value" }, axis: { x: { title: axis }, y: { title: unit } },
    };
    return { renderer: "antv" as const, tool: "render_antv", options };
  }

  const numeric = points.flatMap(({ label, value }) => value === null ? [] : [{ label, value }]);
  const values = await generateChartOption(chart, title, unit, axis, numeric, signal);
  let index = 0;
  const series = points.map(({ value }) => value === null ? null : values[index++]);
  const options: EChartsOption = {
    animation: false, title: { text: title, left: "center" },
    grid: { left: 92, right: 40, bottom: 70, top: 64 },
    tooltip: { trigger: "axis", renderMode: "richText" },
    xAxis: { type: "category", data: points.map(({ label }) => label), name: axis, nameLocation: "middle", nameGap: 36 },
    yAxis: { type: "value", name: unit },
    series: [chart === "line"
      ? { type: "line", data: series, connectNulls: false }
      : { type: "bar", data: series, barMaxWidth: 40 }],
  };
  return { renderer: "mcp-echarts" as const, tool: chartTools[chart], options };
}

export async function visualizeResult(request: Request, projectKey: string | null, signal: AbortSignal) {
  if (request.action === "create_session" || request.action === "get_session") {
    await assertDataProject(request.project_id, projectKey);
    if (request.action === "create_session") return await createAgentSession(request.project_id, "visualization");
    const session = await getAgentSession(request.project_id, request.session_id, "visualization");
    if (!session) throw new DataAgentError("PROJECT_NOT_FOUND", "该项目没有此可视化会话。");
    return session;
  }
  if (request.action === "scene") {
    await assertDataProject(request.project_id, projectKey);
    return powerScene(request, signal);
  }
  if (active >= 3) throw new DataAgentError("BUSY", "可视化服务正在处理其他请求，请稍后重试。");
  active += 1;
  try {
    if (request.action === "ask_session") await assertDataProject(request.project_id, projectKey);
    const session = request.action === "ask_session" ? await getAgentSession(request.project_id, request.session_id, "visualization") : undefined;
    if (request.action === "ask_session" && (!session || session.revision !== request.revision)) {
      throw new DataAgentError("SESSION_CONFLICT", "请刷新可视化会话后重试。");
    }
    const resultId = request.result_id ?? session?.summary.result_id;
    if (!resultId) return { status: "empty" as const, error: "请先指定项目中一份已保存的查询结果。" };
    const result = await resolveDataResult(request.project_id, resultId, projectKey);
    signal.throwIfAborted();
    const { metric, rows } = result;
    if (!rows.some(row => row.value !== null)) return { status: "empty" as const, error: "该查询结果没有可绘制的观测值。" };
    const monthly = metric.time_grain === "month";
    const forecast = metric.time_grain === "forecast_frame";
    const timeAxis = monthly ? "月份" : forecast ? "有效时刻（UTC）" : "日期";
    const points = pointsSchema.parse(rows.map(({ time_start, value }) => ({
      label: monthly ? time_start.slice(0, 7) : forecast ? time_start.slice(0, 16).replace("T", " ") : time_start.slice(0, 10),
      value: value === null ? null : Number(value),
    })));

    const previous = settingsSchema.safeParse(session?.summary.selection).data;
    const selection = request.action === "render" ? { chart: request.chart, renderer: request.renderer } : await selectWithPi({
      tool: "select_chart", schema: choiceSchema, signal,
      prompt: [
        "你是 OpenGridWorks 的可视化选图层。只调用一次 select_chart。使用已保存的单指标时间序列，不改数据。",
        "趋势或折线图选 line，数值比较或柱状图选 bar。要求改数据、其他图种或不明意图选 unsupported。",
        "用户明确指定 ECharts、VChart、AntV 时选择对应 renderer。未指定时省略 renderer。",
        "若只要求切换渲染器，保留 previous.chart。其他追问保留未改动的图表设置。",
      ].join("\n"),
      context: { instruction: request.instruction, metric: { name: metric.name, grain: metric.time_grain },
        points: points.length, previous, recent: session?.recent },
    });
    if (!selection || selection.chart === "unsupported") {
      return { status: "unsupported" as const, error: "当前模板支持对已保存结果绘制折线图或柱状图。" };
    }
    const chart = selection.chart;
    const renderer = request.renderer ?? selection.renderer ?? previous?.renderer ?? "echarts";
    const location = rows[0]?.source_ref.region_name;
    const title = [typeof location === "string" ? location : "", metric.name].filter(Boolean).join(" · ");
    const spec = await renderOptions(chart, renderer, points, title, metric.unit, timeAxis, signal);
    signal.throwIfAborted();
    const saved = session && request.action === "ask_session"
      ? await advanceAgentSession(session, "visualization", { result_id: resultId, selection: { chart, renderer } },
        { instruction: request.instruction, status: "ok", selection: { chart, renderer } })
      : undefined;
    if (saved?.status === "conflict") throw new DataAgentError("SESSION_CONFLICT", "可视化会话已有新消息，请刷新后重试。");
    return {
      status: "ok" as const, mode: request.action === "render" ? "direct" : "pi", ...spec, result_id: resultId,
      template_id: `${renderer}.${chart}.time-series`, template_version: "1",
      data_ref: result.data_ref, field_mapping: { x: "time_start", y: "value" }, events: [],
      ...(saved?.status === "saved" ? { session_id: session?.session_id, revision: saved.revision } : {}),
    };
  } finally {
    active -= 1;
  }
}
