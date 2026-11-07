import "server-only";

import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export function energyPiConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (process.env.NODE_ENV === "production" || process.env.ENERGY_PI_ENABLED !== "true" || !apiKey) return null;
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel("deepseek", process.env.ENERGY_PI_MODEL?.trim() || "deepseek-flash");
  return model ? { apiKey, models, model } : null;
}

export type EnergyPiConfig = NonNullable<ReturnType<typeof energyPiConfig>>;

export function piTool(
  name: string, label: string, description: string, properties: Record<string, object>,
  execute: (args: unknown, signal?: AbortSignal) => Promise<unknown>,
): AgentTool {
  return {
    name, label, description, parameters: { type: "object", properties, additionalProperties: false },
    execute: async (_callId, args, signal) => ({
      content: [{ type: "text", text: JSON.stringify(await execute(args, signal)) }], details: undefined,
    }),
  };
}

// Reuses the Greensystem Pi manager's sequential tool loop and per-run tool budget.
export async function runPiAgent(
  config: EnergyPiConfig, prompt: string, question: string, tools: AgentTool[], budget: number, signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let calls = 0;
  const agent = new Agent({
    initialState: { model: config.model, systemPrompt: prompt, tools, thinkingLevel: "off" },
    streamFn: (model, context, options) => config.models.streamSimple(model, context, { ...options, maxTokens: 800 }),
    getApiKey: (provider) => provider === "deepseek" ? config.apiKey : undefined,
    toolExecution: "sequential",
    maxRetryDelayMs: 1500,
    beforeToolCall: async () => {
      calls += 1;
      if (calls > budget) return { block: true, reason: "达到本次查询的工具调用上限", terminate: true };
    },
  });
  const abort = () => agent.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await agent.prompt(question);
    signal?.throwIfAborted();
    if (agent.state.errorMessage) throw new Error("Pi provider request failed");
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
