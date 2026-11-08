import "server-only";

import { Agent } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { withAgentRun } from "./policy.server";
import { getPiModel } from "@/lib/data-agent/pi.server";

export async function selectWithPi<T>(input: {
  prompt: string; context: unknown; tool: "select_chart" | "plan_analysis"; schema: z.ZodType<T>; signal: AbortSignal;
}): Promise<T | undefined> {
  return withAgentRun(input.tool === "select_chart" ? "chartPlan" : "analysisPlan", input.signal, async guard => {
    const { models, model, apiKey } = getPiModel();
    const signal = guard.signal;
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
            const start = Date.now();
            choice ??= input.schema.parse(args);
            guard.record(input.tool, start, { status: "ok" });
            return { content: [{ type: "text", text: "方案已记录。" }], details: undefined };
          },
        }],
      },
      streamFn: (currentModel, context, options) => {
        guard.model();
        return models.streamSimple(currentModel, context, { ...options, maxTokens: 240, maxRetries: 0 });
      },
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall }) => guard.tool(toolCall.name),
      getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
      finishTurn: () => ({ action: "end" }),
    });
    const abort = () => agent.abort();
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    const unsubscribe = agent.subscribe(event => {
      if (event.type === "message_end" && event.message.role === "assistant") guard.usage(event.message);
    });
    try {
      await agent.prompt(JSON.stringify(input.context));
      signal.throwIfAborted();
      if (agent.state.errorMessage) throw new Error("Pi tool selection failed");
      return choice;
    } finally {
      unsubscribe();
      signal.removeEventListener("abort", abort);
    }
  });
}
