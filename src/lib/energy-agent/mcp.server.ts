import "server-only";

import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { energyTechnologies, type EnergyEvidenceRef, type EnergyEvidenceTopic, type EnergyMetric, type EnergyRow, type EnergyVisualizationSpec } from "./contracts";

const mapEvidence = [
  {
    id: "ogw-map-sample", title: "OpenGridWorks 地图样本口径",
    explanation: "按技术类型计入的是地图记录。项目筛选阈值、采集来源、项目状态和跨源重叠都会影响样本分布。容量字段的单位是 MW，表示容量，不表示发电量。",
  },
  {
    id: "wri-gppd", title: "WRI Global Power Plant Database",
    explanation: "项目地图设施样本的来源之一。其他来源随查询结果列出。",
    url: "https://datasets.wri.org/datasets/global-power-plant-database",
  },
] satisfies EnergyEvidenceRef[];

const tianjiEvidence = [
  {
    id: "envision-tianji", title: "远景天机气象基座模型",
    explanation: "远景官网把天机列为气象基座模型，把 EnOS 列为物联网平台。截至核对时，未找到天机公开的推理代码、权重或可直接申请的开发者 API 文档。",
    url: "https://www.envisioncn.com/future-energy-system",
  },
  {
    id: "ecmwf-arcana", title: "ECMWF AI Weather Quest · Arcana",
    explanation: "远景以 Arcana 参赛。可公开获取部分竞赛提交的次季节概率预报，适合研究展示与回测。可先评估高温或降水异常对能源的影响。场站短时功率预测仍需风速、辐照度和场站实测。对外再发布需核对数据使用条款。",
    url: "https://data.ecmwf.int/ai-weatherquest/by_fc_date/20260702/Arcana/",
  },
] satisfies EnergyEvidenceRef[];

export async function readEnergyEvidence(topic: EnergyEvidenceTopic): Promise<EnergyEvidenceRef[]> {
  const server = new McpServer({ name: "opengridworks-energy-evidence", version: "0.1.0" });
  const client = new Client({ name: "energy-workbench", version: "0.1.0" });
  server.registerTool("get_energy_evidence", {
    description: "读取能源地图样本或候选气象数据源的已登记证据", inputSchema: { topic: z.enum(["map", "tianji"]) },
  }, ({ topic }) => ({
    content: [{ type: "text", text: JSON.stringify(topic === "tianji" ? tianjiEvidence : mapEvidence) }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "get_energy_evidence", arguments: { topic } });
    const payload = mcpText(result);
    return z.array(z.object({ id: z.string(), title: z.string(), explanation: z.string(), url: z.string().url().optional() })).parse(JSON.parse(payload));
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

function mcpText(result: unknown) {
  const parsed = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(result);
  const text = parsed.content.find((part) => part.type === "text")?.text;
  if (parsed.isError || !text) throw new Error("MCP tool did not return text");
  return text;
}

const chartSchema = z.object({
  xAxis: z.object({ data: z.array(z.string()) }),
  series: z.array(z.object({ type: z.literal("bar"), data: z.array(z.number()) })).length(1),
});

let activeCharts = 0;

async function chartFromMcp(data: { category: string; value: number }[], title: string) {
  if (activeCharts >= 2) throw new Error("Chart MCP is busy");
  const entry = join(process.cwd(), "node_modules", "mcp-echarts", "build", "index.js");
  const client = new Client({ name: "opengridworks-chart", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [entry, "--transport", "stdio"], cwd: dirname(entry), stderr: "pipe",
  });
  transport.stderr?.on("data", () => undefined);
  activeCharts += 1;
  try {
    await client.connect(transport, { timeout: 4000 });
    const result = await client.callTool({
      name: "generate_bar_chart", arguments: { data, title, outputType: "option" },
    }, undefined, { timeout: 4000 });
    const chart = chartSchema.parse(JSON.parse(mcpText(result)));
    if (chart.xAxis.data.length !== data.length || chart.series[0].data.length !== data.length ||
        !data.every((row, index) => row.category === chart.xAxis.data[index] && row.value === chart.series[0].data[index])) {
      throw new Error("Chart output does not match the verified energy rows");
    }
    return chart;
  } finally {
    await transport.close().catch(() => undefined);
    activeCharts -= 1;
  }
}

export async function buildEnergyChart(rows: EnergyRow[], metric: EnergyMetric, dataVersion: string): Promise<EnergyVisualizationSpec> {
  const title = metric === "records" ? "设施地图记录数" : "样本容量字段合计";
  const data = rows.map((row) => ({
    category: energyTechnologies[row.technology], value: metric === "records" ? row.records : row.capacityMw,
  })).sort((a, b) => a.value - b.value);
  const chart = data.length ? await chartFromMcp(data, title).catch((error: unknown) => {
    console.warn("Energy chart MCP unavailable:", error instanceof Error ? error.message : "unknown error");
    return null;
  }) : null;
  const renderer = chart ? "mcp-echarts" : "local-echarts";
  const labels = chart?.xAxis.data ?? data.map((row) => row.category);
  const values = chart?.series[0].data ?? data.map((row) => row.value);
  return {
    metric, title, renderer, dataVersion,
    option: {
      animation: false,
      grid: { left: 88, right: 30, top: 18, bottom: 42 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", name: metric === "records" ? "条" : "MW", nameLocation: "middle", nameGap: 28, splitLine: { lineStyle: { color: "#e8edf4" } } },
      yAxis: { type: "category", data: labels, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#34455d" } },
      series: [{ type: "bar", data: values, barMaxWidth: 20, itemStyle: { color: "#087d6e", borderRadius: [0, 4, 4, 0] } }],
    },
  };
}
