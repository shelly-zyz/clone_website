import "server-only";

import { randomUUID } from "node:crypto";
import type { G2Spec } from "@antv/g2";
import type { IBarChartSpec, ILineChartSpec } from "@visactor/vchart";
import type { EChartsOption } from "echarts";
import { z } from "zod";
import { businessLimits, withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { selectWithPi } from "@/lib/agent-runtime/pi-tool.server";
import { advanceAgentSession, createAgentSession, getAgentSession } from "@/lib/agent-runtime/store";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { profileDataResult } from "@/lib/data-agent/result-profile";
import { assertDataProject, resolveDataResult } from "@/lib/data-agent/state.server";
import { chartBackends, chartReferenceSchema, chartSelectionSchema, chartTypes, type ChartBackend, type ChartType, type visualizationRequestSchema } from "./contracts";
import { chartTools, generateChartOption } from "./echarts-mcp.server";
import { powerScene } from "./scene.server";

type Request = z.infer<typeof visualizationRequestSchema>;
type Point = { label: string; value: number | null };
const choiceSchema = z.strictObject({ chart: z.enum([...chartTypes, "unsupported"]), renderer: z.enum(chartBackends).optional() });
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

  const external = process.env.OGW_CHART_ECHARTS_MCP === "true";
  const numeric = points.flatMap(({ label, value }) => value === null ? [] : [{ label, value }]);
  const values = external ? await generateChartOption(chart, title, unit, axis, numeric, signal) : numeric.map(({ value }) => value);
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
  return { renderer: external ? "mcp-echarts" as const : "echarts" as const, tool: external ? chartTools[chart] : "render_echarts", options };
}

export async function visualizeResult(request: Request, projectKey: string | null, signal: AbortSignal, chartId?: string) {
  return withBusinessAction("visualization", request.action, () => executeVisualization(request, projectKey, signal, chartId), request.project_id);
}

async function executeVisualization(request: Request, projectKey: string | null, signal: AbortSignal, chartId?: string) {
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
  if (active >= businessLimits.chartConcurrency) throw new DataAgentError("BUSY", "可视化服务正在处理其他请求，请稍后重试。");
  active += 1;
  try {
    const scoped = request.action === "ask_session" || request.action === "render_session";
    if (scoped) await assertDataProject(request.project_id, projectKey);
    const session = scoped ? await getAgentSession(request.project_id, request.session_id, "visualization") : undefined;
    if (scoped && (!session || session.revision !== request.revision)) {
      throw new DataAgentError("SESSION_CONFLICT", "请刷新可视化会话后重试。");
    }
    const replay = chartId && request.action === "render_session" ? session?.recent
      .map(turn => chartReferenceSchema.safeParse(turn.selection).data).find(ref => ref?.chart_id === chartId) : undefined;
    const resultId = replay?.result_id ?? request.result_id ?? session?.summary.result_id;
    if (!resultId) return { status: "empty" as const, error: "请先指定项目中一份已保存的查询结果。" };
    const result = await resolveDataResult(request.project_id, resultId, projectKey);
    signal.throwIfAborted();
    const { metric, rows } = result;
    const profile = profileDataResult(result);
    const category = profile.shape === "category";
    if (!profile.chart) return { status: "empty" as const, error: "该查询结果没有可绘制的有效观测值。" };
    const monthly = metric.time_grain === "month";
    const forecast = metric.time_grain === "forecast_frame";
    const timeAxis = category ? "省级地区" : monthly ? "月份" : forecast ? "有效时刻（UTC）" : "日期";
    const points = pointsSchema.parse(rows.map(({ time_start, value, source_ref, entity_code }) => ({
      label: category ? String(source_ref.region_name || entity_code) : monthly ? time_start.slice(0, 7) : forecast ? time_start.slice(0, 16).replace("T", " ") : time_start.slice(0, 10),
      value: value === null ? null : Number(value),
    })));

    const previous = chartSelectionSchema.safeParse(session?.summary.selection).data;
    const direct = request.action === "render" || request.action === "render_session";
    const selection = replay?.selection ?? (direct ? { chart: request.chart, renderer: request.renderer } : await selectWithPi({
      tool: "select_chart", schema: choiceSchema, signal,
      prompt: [
        "你是 OpenGridWorks 的可视化选图层。只调用一次 select_chart。使用已保存的查询结果。类别比较只能画柱状图。",
        "趋势或折线图选 line，数值比较或柱状图选 bar。要求改数据、其他图种或不明意图选 unsupported。",
        "用户明确指定 ECharts、VChart、AntV 时选择对应 renderer。未指定时省略 renderer。",
        "若只要求切换渲染器，保留 previous.chart。其他追问保留未改动的图表设置。",
      ].join("\n"),
      context: { instruction: request.instruction, metric: { name: metric.name, grain: metric.time_grain },
        points: points.length, shape: profile.shape, previous, recent: session?.recent },
    }));
    if (!selection || selection.chart === "unsupported") {
      return { status: "unsupported" as const, error: "当前模板支持对已保存结果绘制折线图或柱状图。" };
    }
    const chart = selection.chart;
    if (category && chart !== "bar") return { status: "unsupported" as const, error: "同月省级比较请用柱状图。" };
    const renderer = replay?.selection.renderer ?? request.renderer ?? selection.renderer ?? previous?.renderer ?? "echarts";
    const location = category ? `${rows[0]?.time_start.slice(0, 7)} 各省` : rows[0]?.source_ref.region_name;
    const issue = rows[0]?.issue_time;
    const title = [typeof location === "string" ? location : "", metric.name,
      forecast && issue ? `GFS 起报 ${issue.slice(0, 16).replace("T", " ")} UTC` : ""].filter(Boolean).join(" · ");
    const spec = await renderOptions(chart, renderer, points, title, metric.unit, timeAxis, signal);
    signal.throwIfAborted();
    const reference = { chart_id: chartId ?? randomUUID(), result_id: resultId, selection: { chart, renderer } };
    const saved = session && scoped && !replay
      ? await advanceAgentSession(session, "visualization", reference,
        { instruction: request.instruction, status: "ok", selection: reference })
      : undefined;
    if (saved?.status === "conflict") throw new DataAgentError("SESSION_CONFLICT", "可视化会话已有新消息，请刷新后重试。");
    return {
      status: "ok" as const, mode: direct ? "direct" : "pi", ...spec, result_id: resultId,
      template_id: `${renderer}.${chart}.${category ? "category" : "time-series"}`, template_version: "1",
      data_ref: result.data_ref, field_mapping: { x: category ? "entity_code" : "time_start", y: "value" }, events: [],
      ...(replay ? { chart_id: replay.chart_id, session_id: session?.session_id, revision: session?.revision } : {}),
      ...(saved?.status === "saved" ? { chart_id: reference.chart_id, session_id: session?.session_id, revision: saved.revision } : {}),
    };
  } finally {
    active -= 1;
  }
}
