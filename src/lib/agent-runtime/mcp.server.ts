import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { authorizeDataAgent } from "@/lib/data-agent/http.server";

export async function mcpResult(run: () => Promise<object>) {
  try {
    const value = await run();
    const failure = "status" in value && ["unsupported", "empty", "failed"].includes(String(value.status));
    return { isError: failure, content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { ...value } };
  } catch (error) {
    const result = error instanceof DataAgentError ? { code: error.code, error: error.message }
      : { code: "UNAVAILABLE", error: "Agent 工具暂时不可用。" };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
}

export async function serveAgentMcp(request: Request, name: string, register: (server: McpServer) => void) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  const server = new McpServer({ name, version: "0.1.0" });
  register(server);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
