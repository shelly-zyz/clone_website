import "server-only";

import { Agent } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { getPiModel } from "@/lib/data-agent/pi.server";
import { chartTypes, type ChartType } from "./contracts";

const selections = [...chartTypes, "unsupported"] as const;
const selectionSchema = z.strictObject({ chart: z.enum(selections) });

export async function selectChart(
  instruction: string, metric: { name: string; time_grain: string }, points: number, signal: AbortSignal,
): Promise<ChartType | undefined> {
  const { models, model, apiKey } = getPiModel();
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  let selection: (typeof selections)[number] | undefined;
  const agent = new Agent({
    initialState: {
      model, thinkingLevel: "off",
      systemPrompt: "你是 OpenGridWorks 的可视化 Agent。根据用户指令为已保存的单指标时间序列选择图表。趋势或明确要求折线图选 line，数值比较或明确要求柱状图选 bar。其他图表、要求改数据范围或与绘图无关的任务选 unsupported。只调用一次 select_chart，不输出文字。",
      tools: [{
        name: "select_chart", label: "选择图表模板", description: "选择已登记的 ECharts 图表类型",
        parameters: {
          type: "object", required: ["chart"], additionalProperties: false,
          properties: { chart: { type: "string", enum: [...selections] } },
        },
        execute: async (_id, args) => {
          selection ??= selectionSchema.parse(args).chart;
          return { content: [{ type: "text", text: "图表类型已记录。" }], details: undefined };
        },
      }],
    },
    streamFn: (currentModel, context, options) => models.streamSimple(currentModel, context, {
      ...options, maxTokens: 120, maxRetries: 0,
    }),
    getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
    finishTurn: () => ({ action: "end" }),
  });
  const abort = () => agent.abort();
  timeout.throwIfAborted();
  timeout.addEventListener("abort", abort, { once: true });
  try {
    await agent.prompt(JSON.stringify({ instruction, metric, points }));
    timeout.throwIfAborted();
    if (agent.state.errorMessage) throw new Error("Visualization Pi request failed");
    return selection === "unsupported" ? undefined : selection;
  } finally {
    timeout.removeEventListener("abort", abort);
  }
}
