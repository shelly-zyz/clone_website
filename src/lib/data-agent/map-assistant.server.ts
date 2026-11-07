import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { DataAgentError, runDataAgentWrite } from "./database.server";
import { getPiModel } from "./pi.server";
import { listDataCatalog } from "./query.server";

const recentSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).max(8);
const hash = (threadId: string) => createHash("sha256").update(threadId).digest("hex");
let active = 0;

const tools: AgentTool[] = [
  {
    name: "utc_now", label: "UTC 时间", description: "返回当前 UTC 时间",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: "text", text: new Date().toISOString() }], details: undefined }),
  },
  {
    name: "list_available_datasets", label: "数据目录", description: "查看 OpenGridWorks 已发布的数据集及指标口径",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      try {
        const { datasets } = await listDataCatalog();
        const summary = datasets.map(({ topic, dataset_id, metrics }) => ({
          topic, dataset_id, metrics: metrics.map(({ name, unit }) => ({ name, unit })),
        }));
        return { content: [{ type: "text", text: JSON.stringify(summary) }], details: undefined };
      } catch {
        return { content: [{ type: "text", text: "数据目录暂不可用。" }], details: undefined, isError: true };
      }
    },
  },
];

export async function askMapAssistant(message: string, incomingThreadId: string | null, signal: AbortSignal) {
  if (active >= 2) throw new DataAgentError("BUSY", "地图助手正在处理其他请求，请稍后再试。");
  const { models, model, apiKey } = getPiModel();
  const previous = incomingThreadId && /^[A-Za-z0-9_-]{43}$/.test(incomingThreadId)
    ? await runDataAgentWrite("green_agent_context", async (client) => {
      const { rows } = await client.query<{ revision: number; recent: unknown }>(
        "SELECT revision, recent FROM projects.map_assistant_thread WHERE access_hash = $1", [hash(incomingThreadId)]);
      return rows[0];
    })
    : undefined;
  const threadId = previous && incomingThreadId ? incomingThreadId : randomBytes(32).toString("base64url");
  const recent = previous ? recentSchema.parse(previous.recent) : [];
  if (active >= 2) throw new DataAgentError("BUSY", "地图助手正在处理其他请求，请稍后再试。");
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  let rounds = 0;
  const agent = new Agent({
    initialState: {
      model, tools, thinkingLevel: "off",
      systemPrompt: "你是 OpenGridWorks 地图助手。用中文回答地图、图层、能源设施和数据口径相关问题。涉及实际数据库观测时，指引用户通过对应专题的数据库问数接口取数。仅在需要当前时间或核对已发布数据范围时使用相应工具。工具失败时简要说明。不要把未经核实的数值说成站点数据。历史消息仅作为参考，回答当前问题。",
    },
    streamFn: (currentModel, context, options) => {
      rounds += 1;
      return models.streamSimple(currentModel, context, { ...options, maxTokens: 650, maxRetries: 0 });
    },
    getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
    finishTurn: ({ toolResults }) => {
      if (rounds >= 3 || toolResults.some((tool) => tool.isError)) return { action: "end" };
    },
  });
  const abort = () => agent.abort();
  timeout.throwIfAborted();
  timeout.addEventListener("abort", abort, { once: true });
  active += 1;
  try {
    await agent.prompt(recent.length ? JSON.stringify({ recent, message }) : message);
    timeout.throwIfAborted();
    if (agent.state.errorMessage) throw new Error("Map assistant provider failed");
    const last = agent.state.messages.at(-1);
    const answer = last?.role === "assistant"
      ? last.content.filter((item) => item.type === "text").map(({ text }) => text).join("\n").trim() : "";
    const reply = answer || "当前没有可展示的答案，请换一种问法再试。";
    const next = [...recent, { role: "user", text: message }, { role: "assistant", text: reply }].slice(-8);
    await runDataAgentWrite("green_agent_context", async (client) => {
      const payload = JSON.stringify(next);
      if (!previous) {
        await client.query("INSERT INTO projects.map_assistant_thread (access_hash, recent) VALUES ($1,$2)", [hash(threadId), payload]);
        return;
      }
      const updated = await client.query(`
        UPDATE projects.map_assistant_thread SET recent = $2, revision = revision + 1, updated_at = now()
        WHERE access_hash = $1 AND revision = $3`, [hash(threadId), payload, previous.revision]);
      if (!updated.rowCount) throw new DataAgentError("SESSION_CONFLICT", "会话已有新消息，请重试。");
    });
    return { threadId, answer: reply };
  } finally {
    active -= 1;
    timeout.removeEventListener("abort", abort);
  }
}
