import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { dataQuerySchema, topicSchema } from "@/lib/data-agent/contracts";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { authorizeDataAgent } from "@/lib/data-agent/http.server";
import { listDataCatalog, queryData } from "@/lib/data-agent/query.server";
import { resolveDataResult } from "@/lib/data-agent/state.server";

export const runtime = "nodejs";

async function resultOf(run: () => Promise<object>) {
  try {
    const result = await run();
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: { ...result } };
  } catch (error) {
    const detail = error instanceof DataAgentError ? { code: error.code, error: error.message }
      : { code: "UNAVAILABLE", error: "数据库 Agent 暂时不可用。" };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(detail) }] };
  }
}

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  const server = new McpServer({ name: "opengridworks-data-agent", version: "0.1.0" });
  server.registerTool("list_published_catalog", {
    description: "读取气象、电力、碳专题的当前发布版本与审核指标。", inputSchema: z.strictObject({ topic: topicSchema.optional() }),
  }, ({ topic }) => resultOf(() => listDataCatalog(topic)));
  server.registerTool("query_published_data", {
    description: "执行批准的只读指标查询，返回数据引用、口径、质量标记及有限行数。", inputSchema: z.strictObject({ query: dataQuerySchema }),
  }, ({ query }) => resultOf(() => queryData(query)));
  server.registerTool("resolve_project_result", {
    description: "使用项目访问凭据读取此前保存的查询结果及 DataRef。",
    inputSchema: z.strictObject({ project_id: z.uuid(), result_id: z.uuid() }),
  }, ({ project_id, result_id }) => resultOf(() => resolveDataResult(project_id, result_id, request.headers.get("x-data-project-key"))));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
