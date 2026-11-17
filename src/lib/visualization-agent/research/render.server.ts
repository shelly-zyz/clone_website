import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { buildECharts } from "./echarts";
import { VisualizationError, type Engine, type FigureRender } from "./contracts";
import type { PreparedFigure } from "./planner";

const flintVersion = "1.0.1";
const matplotlibVersion = "3.11.2";
const safeEnv = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" as const };

export function renderingCapabilities() {
  return {
    echarts: { available: true, version: "6.1.0", output: ["svg", "json"] },
    flint: { available: isAbsolute(process.env.OGW_VIZ_FLINT_ENTRY ?? ""), version: flintVersion, output: ["svg", "json"] },
    matplotlib: { available: isAbsolute(process.env.OGW_VIZ_PYTHON ?? ""), version: matplotlibVersion, output: ["svg", "png", "pdf", "python", "json"] },
    plotly: { available: false, version: null, output: [] },
  } satisfies Record<Engine, { available: boolean; version: string | null; output: string[] }>;
}
export const availableEngines = () => (Object.entries(renderingCapabilities()) as [Engine, { available: boolean }][])
  .flatMap(([engine, info]) => info.available ? [engine] : []);

const valid = z.object({ valid: z.literal(true), errors: z.array(z.unknown()).max(0).optional() });
const config = z.object({ backend: z.literal("echarts"), chartType: z.string(), spec: z.object({
  xAxis: z.object({ data: z.array(z.string()) }).passthrough(),
  yAxis: z.object({}).passthrough(),
  series: z.array(z.object({ type: z.enum(["line", "bar"]), data: z.array(z.number().nullable()) }).passthrough()).length(1),
}).passthrough() });

async function compileWithFlint(prepared: PreparedFigure, signal: AbortSignal): Promise<FigureRender> {
  const entry = process.env.OGW_VIZ_FLINT_ENTRY;
  if (!entry || !isAbsolute(entry)) throw new VisualizationError("ENGINE_UNAVAILABLE", "Flint 需要配置本地 stdio 入口。");
  const release = await readFile(join(dirname(entry), "..", "package.json"), "utf8").then(value => z.object({
    name: z.literal("flint-chart-mcp"), version: z.literal(flintVersion),
  }).safeParse(JSON.parse(value)).success).catch(() => false);
  if (!release) throw new VisualizationError("ENGINE_UNAVAILABLE", "Flint 的安装版本无法核对，请检查 1.0.1 的本地入口。");

  const client = new Client({ name: "opengridworks-research-figure", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "--disable-file-reference"],
    cwd: dirname(entry), env: safeEnv, stderr: "pipe" });
  transport.stderr?.on("data", () => undefined);
  const panel = prepared.model.panels[0];
  const type = prepared.plan.chart === "columns" ? "Bar Chart" : "Line Chart";
  const values = panel.series[0].data;
  const labels = panel.axis === "time" ? panel.x.map(value => {
    const grain = prepared.plan.datasets[0].dimensions.time_grain;
    return grain === "year" ? value.slice(0, 4) : grain === "month" ? value.slice(0, 7) : grain === "day" ? value.slice(0, 10) : value;
  }) : panel.x;
  if (new Set(labels).size !== labels.length) throw new VisualizationError("VALIDATION_FAILED", "Flint 编译前发现重复数据键。");
  const args = { backend: "echarts", data: { values: labels.map((x, index) => ({ x, y: values[index] })) },
    chart_spec: { chartType: type, encodings: { x: { field: "x", type: "ordinal" }, y: { field: "y", type: "quantitative" } } } };
  const options = { signal, timeout: 5000 };
  async function call(name: "validate_chart" | "compile_chart") {
    const response = await client.callTool({ name, arguments: args }, undefined, options);
    const first = Array.isArray(response.content) ? response.content.find(part => part.type === "text") : undefined;
    if (response.isError || !first || first.type !== "text") throw new VisualizationError("VALIDATION_FAILED", "Flint 拒绝了当前图型或字段映射。");
    return JSON.parse(first.text) as unknown;
  }
  try {
    await client.connect(transport, options);
    const { tools } = await client.listTools({}, options);
    if (!["validate_chart", "compile_chart"].every(name => tools.some(tool => tool.name === name))) {
      throw new VisualizationError("ENGINE_UNAVAILABLE", "Flint 服务的工具清单与预期版本不一致。");
    }
    if (!valid.safeParse(await call("validate_chart")).success) throw new VisualizationError("VALIDATION_FAILED", "Flint 规范校验未通过。");
    const compiled = config.safeParse(await call("compile_chart")).data;
    const generated = compiled?.spec.series[0];
    if (!compiled || !generated || generated.type !== (type === "Bar Chart" ? "bar" : "line") ||
      labels.length !== generated.data.length || labels.length !== compiled.spec.xAxis.data.length ||
      labels.some((value, i) => value !== compiled.spec.xAxis.data[i] || values[i] !== generated.data[i])) {
      throw new VisualizationError("VALIDATION_FAILED", "Flint 编译改变了数据键、数值或空值。请选择兼容的 ECharts 配方。");
    }
    const { design } = prepared.plan;
    // The compiled figure is the sole option. Only presentation tokens are applied here.
    return { kind: "echarts", option: { ...compiled.spec, animation: false, backgroundColor: design.background, color: design.colors,
      textStyle: { fontFamily: design.font, color: design.foreground, fontSize: design.font_size },
      title: { text: prepared.model.title.slice(0, 58), left: "center", top: 8, textStyle: { color: design.foreground, fontSize: design.font_size + 3 } },
      grid: { left: 64, right: 30, top: 54, bottom: 58 },
      xAxis: { ...compiled.spec.xAxis, name: panel.axis === "time" ? "统计时间" : "类别" },
      yAxis: { ...compiled.spec.yAxis, name: panel.series[0].unit, nameLocation: "end", nameGap: 12,
        ...(generated.type === "bar" ? { min: undefined, max: undefined, scale: false } : {}) },
      tooltip: { trigger: "axis", renderMode: "richText", confine: true },
      series: [{ ...generated, name: panel.series[0].name, connectNulls: false,
        itemStyle: { color: design.colors[0] }, lineStyle: { color: design.colors[0] } }] } };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof VisualizationError) throw error;
    throw new VisualizationError("ENGINE_UNAVAILABLE", "Flint 服务不可用或编译超时。");
  } finally {
    await client.close().catch(() => undefined);
  }
}

const scriptPath = () => join(process.cwd(), "scripts", "visualization", "render_figure.py");
type PaperFormat = "svg" | "png" | "pdf";
let activePaper = 0;

export async function exportPaper(figure: PreparedFigure, format: PaperFormat, signal: AbortSignal) {
  const python = process.env.OGW_VIZ_PYTHON;
  if (!python || !isAbsolute(python)) throw new VisualizationError("ENGINE_UNAVAILABLE", "论文导出需要配置受限 Python 运行环境。");
  if (activePaper >= 2) throw new VisualizationError("BUSY", "论文图件正在渲染，请稍后重试。");
  activePaper++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "ogw-paper-"));
    const input = join(directory, "figure.json");
    const output = join(directory, "figure." + format);
    const payload = JSON.stringify({ model: figure.model, design: figure.plan.design });
    if (Buffer.byteLength(payload) > 2_500_000) throw new VisualizationError("INCOMPATIBLE", "论文图件输入超过受控渲染预算。");
    await writeFile(input, payload, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => execFile(python, ["-I", scriptPath(), input, output], {
      cwd: directory, env: { ...safeEnv, MPLCONFIGDIR: directory!, MPLBACKEND: "Agg", OPENBLAS_NUM_THREADS: "1",
        ...(process.env.OGW_VIZ_FONT_FILE && isAbsolute(process.env.OGW_VIZ_FONT_FILE)
          ? { OGW_VIZ_FONT_FILE: process.env.OGW_VIZ_FONT_FILE } : {}) },
      timeout: 14_000, killSignal: "SIGKILL", maxBuffer: 64_000, signal,
    }, error => error ? reject(error) : resolve()));
    const bytes = await readFile(output);
    if (!bytes.length || bytes.length > 4_000_000) throw new VisualizationError("VALIDATION_FAILED", "图件为空或超出导出大小预算。");
    if (format === "svg") assertSvg(bytes.toString());
    if (format === "pdf" && (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || !bytes.subarray(-50).includes("%%EOF"))) {
      throw new VisualizationError("VALIDATION_FAILED", "PDF 文件校验未通过。");
    }
    if (format === "png" && (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.length < 24 || bytes.readUInt32BE(16) < 100 || bytes.readUInt32BE(20) < 100)) {
      throw new VisualizationError("VALIDATION_FAILED", "PNG 文件或图件尺寸校验未通过。");
    }
    return bytes;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof VisualizationError) throw error;
    throw new VisualizationError("ENGINE_UNAVAILABLE", "论文渲染失败。请检查 Matplotlib 版本、字体和任务耗时。");
  } finally {
    activePaper--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

const assertSvg = (svg: string) => {
  if (!/<svg\b/.test(svg) || !/<\/svg>/.test(svg) || /<(?:script|foreignObject)\b|\son(?:load|error|click)\s*=/i.test(svg)) {
    throw new VisualizationError("VALIDATION_FAILED", "SVG 结构或图件内容校验未通过。");
  }
};

export async function exportECharts(option: Record<string, unknown>, prepared: PreparedFigure) {
  const { init } = await import("echarts");
  const figure = init(null, undefined, { renderer: "svg", ssr: true,
    width: Math.round(prepared.plan.design.width_mm * 5.7), height: Math.round(prepared.plan.design.height_mm * 5.7) });
  try {
    figure.setOption(option);
    const svg = figure.renderToSVGString();
    assertSvg(svg);
    return Buffer.from(svg);
  } finally {
    figure.dispose();
  }
}

export async function renderFigure(prepared: PreparedFigure, signal: AbortSignal): Promise<FigureRender> {
  const engine = prepared.plan.engine;
  if (engine === "flint") return compileWithFlint(prepared, signal);
  if (engine === "matplotlib") return { kind: "image", format: "svg", base64: (await exportPaper(prepared, "svg", signal)).toString("base64") };
  if (engine !== "echarts") throw new VisualizationError("ENGINE_UNAVAILABLE", "当前部署尚未启用此主渲染器。");
  const option = buildECharts(prepared.model, prepared.plan.design);
  return { kind: "echarts", option: { ...option } };
}

export async function pythonSource(prepared: PreparedFigure) {
  const script = await readFile(scriptPath(), "utf8");
  const payload = Buffer.from(JSON.stringify({ model: prepared.model, design: prepared.plan.design })).toString("base64");
  const source = script.substring(0, script.indexOf('if __name__ == "__main__":'));
  return Buffer.from(source + '\nif __name__ == "__main__":\n    import base64\n    data = json.loads(base64.b64decode("' + payload + '"))\n    draw(data, sys.argv[1] if len(sys.argv) > 1 else "figure.svg")\n');
}
