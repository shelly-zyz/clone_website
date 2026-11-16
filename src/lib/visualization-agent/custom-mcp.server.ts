import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpResult } from "@/lib/agent-runtime/mcp.server";
import { customMcpInputSchema } from "./contracts";
import { visualizeResult } from "./visualization.server";

export const customChartTool = "render_custom_chart";
export const visualizationMcpName = "opengridworks-visualization";

type Scope = { key: string | null; signal: AbortSignal; session?: { session_id: string; revision: number; instruction: string; chartId?: string } };
type ChartInput = z.infer<typeof customMcpInputSchema>;

export function registerCustomChart(server: McpServer, { key, signal, session }: Scope) {
  server.registerTool(customChartTool, {
    description: "用项目授权的 DataRef 生成科研风格的趋势带、排序点图或柱状图，以及基于原始数值的文字解读。",
    inputSchema: customMcpInputSchema,
  }, ({ template, palette = "lavender", ...reference }, extra) => {
    const render = { ...reference, custom: { template, palette }, chart: template === "ribbon" ? "line" as const : "bar" as const };
    const combined = AbortSignal.any([signal, extra.signal]);
    return mcpResult(() => session ? visualizeResult({ action: "render_session", ...render,
      session_id: session.session_id, revision: session.revision, instruction: session.instruction }, key, combined, session.chartId)
      : visualizeResult({ action: "render", ...render }, key, combined));
  });
}

const finding = z.object({ label: z.string(), text: z.string() });
const renderReceipt = z.object({ status: z.literal("ok"), chart_id: z.uuid(), result_id: z.uuid(), renderer: z.literal("echarts"),
  options: z.record(z.string(), z.unknown()), template_id: z.string(),
  story: z.object({ highlights: z.array(finding), sections: z.array(finding) }),
});

// The project key stays on the server side of the transport. Both clients use
// the same registered MCP tool and therefore the same validation and renderer.
export async function callCustomChartMcp(input: ChartInput, scope: Scope) {
  const server = new McpServer({ name: visualizationMcpName, version: "0.1.0" });
  registerCustomChart(server, scope);
  const client = new Client({ name: "opengridworks-xiaoyun", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport, { signal: scope.signal });
    const result = await client.callTool({ name: customChartTool, arguments: input }, undefined, { signal: scope.signal });
    const receipt = !result.isError && renderReceipt.safeParse(result.structuredContent).data;
    if (receipt) return receipt;
    const error = z.object({ error: z.string() }).safeParse(result.structuredContent).data?.error;
    return { status: "failed" as const, error: error ?? "暂时无法通过制图服务生成图表。" };
  } finally {
    await client.close();
    await server.close();
  }
}
