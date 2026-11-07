import "server-only";

import { dirname, isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { chartTypes, type ChartType } from "./contracts";

const optionSchema = z.object({
  xAxis: z.object({ data: z.array(z.string()) }),
  series: z.array(z.object({ type: z.enum(chartTypes), data: z.array(z.number()) })).length(1),
});

export const chartTools = { line: "generate_line_chart", bar: "generate_bar_chart" } as const;

export async function generateChartOption(
  chart: ChartType, title: string, unit: string, timeAxis: string, points: { label: string; value: number }[], signal: AbortSignal,
) {
  signal.throwIfAborted();
  // Webpack dev can return the external module name instead of its disk path.
  const resolved = require.resolve("mcp-echarts");
  const entry = typeof resolved === "string" && isAbsolute(resolved)
    ? resolved : join(process.cwd(), "node_modules", "mcp-echarts", "build", "index.js");
  const client = new Client({ name: "opengridworks-visualization", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [entry, "--transport", "stdio"], cwd: dirname(entry), stderr: "pipe",
  });
  transport.stderr?.on("data", () => undefined);
  try {
    await client.connect(transport, { timeout: 4000, signal });
    const result = await client.callTool({
      name: chartTools[chart],
      arguments: {
        data: points.map(({ label, value }) => chart === "line" ? { time: label, value } : { category: label, value }),
        title, axisXTitle: timeAxis, axisYTitle: unit, outputType: "option",
      },
    }, undefined, { timeout: 4000, signal });
    const parts = result.content;
    const payload = Array.isArray(parts) ? parts.find((part) => part.type === "text")?.text : undefined;
    if (result.isError || typeof payload !== "string") throw new Error("ECharts MCP returned an invalid result");
    const option = optionSchema.parse(JSON.parse(payload));
    const { data, type } = option.series[0];
    if (type !== chart || data.length !== points.length || option.xAxis.data.length !== points.length ||
        points.some(({ label, value }, index) => option.xAxis.data[index] !== label || data[index] !== value)) {
      throw new Error("ECharts MCP changed the input series");
    }
    return data;
  } finally {
    await client.close().catch(() => undefined);
  }
}
