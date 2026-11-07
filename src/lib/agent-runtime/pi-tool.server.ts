import "server-only";

import { Agent } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { getPiModel } from "@/lib/data-agent/pi.server";

let active = 0;

export async function selectWithPi<T>(input: {
  prompt: string; context: unknown; tool: string; schema: z.ZodType<T>; signal: AbortSignal;
}): Promise<T | undefined> {
  if (active >= 4) throw new DataAgentError("BUSY", "Agent 正在处理其他请求，请稍后重试。");
  const { models, model, apiKey } = getPiModel();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]);
  const { $schema: schemaDraft, ...parameters } = z.toJSONSchema(input.schema);
  void schemaDraft;
  let choice: T | undefined;
  const agent = new Agent({
    initialState: {
      model, thinkingLevel: "off", systemPrompt: input.prompt,
      tools: [{
        name: input.tool, label: input.tool, description: "提交一个受控参数方案",
        parameters: { ...parameters, type: "object" },
        execute: async (_id, args) => {
          choice ??= input.schema.parse(args);
          return { content: [{ type: "text", text: "方案已记录。" }], details: undefined };
        },
      }],
    },
    streamFn: (currentModel, context, options) => models.streamSimple(currentModel, context, {
      ...options, maxTokens: 240, maxRetries: 0,
    }),
    getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
    finishTurn: () => ({ action: "end" }),
  });
  const abort = () => agent.abort();
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  active += 1;
  try {
    await agent.prompt(JSON.stringify(input.context));
    signal.throwIfAborted();
    if (agent.state.errorMessage) throw new Error("Pi tool selection failed");
    return choice;
  } finally {
    active -= 1;
    signal.removeEventListener("abort", abort);
  }
}
