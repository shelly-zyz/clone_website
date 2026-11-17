import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpResult } from "@/lib/agent-runtime/mcp.server";
import { datasetRequestSchema, domains, exportFormats, figureEditSchema, figureReference, projectKeySchema, visualizationJobSchema,
  VisualizationError, type WorkspaceRequest } from "./contracts";
import { researchDomainOperation } from "./domain-tools.server";
import { domainTools } from "./registry";
import { researchWorkspace } from "./service.server";

type WorkspaceCommand = Exclude<WorkspaceRequest, { action: "start" }>;
const datasets = z.array(datasetRequestSchema).min(1).max(6);

async function result(run: () => Promise<object>) {
  return mcpResult(async () => {
    try { return await run(); }
    catch (error) {
      if (error instanceof VisualizationError) return { status: "failed", code: error.code, error: error.message };
      if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
        return { status: "failed", code: "BUSY", error: "制图请求已结束或超时。" };
      }
      throw error;
    }
  });
}

export function registerResearchTools(server: McpServer, key: string | null, signal: AbortSignal) {
  const access = (project_id: string) => ({ project_id, key: projectKeySchema.safeParse(key).data ?? "" });
  const scoped = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...shape, project_id: z.uuid() });
  const job = scoped({ job: visualizationJobSchema });
  const invoke = (command: WorkspaceCommand, project_id: string) => researchWorkspace(command, access(project_id), signal);
  const artifact = { artifact_id: z.uuid() };

  server.registerTool("viz.list_capabilities", {
    description: "列出已配置的引擎、图型、Skill 和发布目录。", inputSchema: z.strictObject({}),
  }, () => result(() => invoke({ action: "catalog" }, "")));
  server.registerTool("viz.profile_dataset", {
    description: "校验项目和数据引用，返回字段、时间、单位、版本及有效样本。", inputSchema: scoped({ datasets }),
  }, args => result(() => invoke({ action: "profile", datasets: args.datasets }, args.project_id)));
  server.registerTool("viz.recommend_charts", {
    description: "核验所选指标与数据范围，返回有样本证据的数据结构和可用图型。", inputSchema: scoped({ datasets }),
  }, args => result(() => invoke({ action: "recommend", datasets: args.datasets }, args.project_id)));
  server.registerTool("viz.create_plan", {
    description: "根据授权数据制定单一渲染计划，返回适用的图型、校验和分析统计。", inputSchema: job,
  }, args => result(() => invoke({ action: "plan", job: args.job }, args.project_id)));
  server.registerTool("viz.render_interactive", {
    description: "生成一个网页交互配置，可显式选择 Flint 编译。", inputSchema: job,
  }, args => result(() => invoke({ action: "render", job: { ...args.job, configuration: { ...args.job.configuration, mode: "interactive" } } }, args.project_id)));
  server.registerTool("viz.render_scientific", {
    description: "通过已配置的 Matplotlib 固定模板生成论文图件。", inputSchema: job,
  }, args => result(() => invoke({ action: "render", job: { ...args.job, configuration: { ...args.job.configuration, mode: "paper" } } }, args.project_id)));
  server.registerTool("viz.edit_chart", {
    description: "对已有图件应用增量配置，复用未修改的数据引用及快照。",
    inputSchema: scoped({ ...artifact, task_id: z.uuid(), patch: figureEditSchema }),
  }, ({ project_id, ...args }) => result(() => invoke({ action: "edit", ...args }, project_id)));
  server.registerTool("viz.validate_chart", {
    description: "从输入到渲染验证完整方案，并返回可导出图件编号。", inputSchema: job,
  }, args => result(() => invoke({ action: "validate", job: args.job }, args.project_id)));
  server.registerTool("viz.export_chart", {
    description: "导出图件，返回 MIME、文件名与 Base64 内容。", inputSchema: scoped({ ...artifact, format: z.enum(exportFormats) }),
  }, ({ project_id, ...args }) => result(async () => {
    const output = await invoke({ action: "export", ...args }, project_id);
    if (!("bytes" in output && output.bytes)) throw new VisualizationError("VALIDATION_FAILED", "导出工具没有返回文件。");
    if (output.bytes.length > 1_500_000) throw new VisualizationError("INCOMPATIBLE", "文件超过 MCP 传输预算，请从工作区下载。");
    return { filename: output.filename, mimeType: output.contentType, base64: output.bytes.toString("base64") };
  }));
  server.registerTool("viz.save_project", {
    description: "在当前数据项目中保存不可变修订，可通过预期修订号防止覆盖。",
    inputSchema: scoped({ ...artifact, figure_id: figureReference.figure_id.optional(), expected_revision: figureReference.revision }),
  }, ({ project_id, ...args }) => result(() => invoke({ action: "save", ...args }, project_id)));
  server.registerTool("viz.open_figure", {
    description: "读取当前项目的图件修订及原始证据快照。", inputSchema: scoped(figureReference),
  }, ({ project_id, ...args }) => result(() => invoke({ action: "open", ...args }, project_id)));
  const domainInput = scoped({ datasets, target_unit: z.string().min(1).max(40).optional(),
    target_frequency: z.enum(["day", "month", "quarter", "year"]).optional() });
  for (const domain of domains) {
    for (const operation of domainTools[domain]) {
      server.registerTool(domain + "." + operation, {
        description: domain + " 数据准备与专业口径校验，返回统计摘要和图型建议。",
        inputSchema: domainInput,
      }, ({ project_id, ...args }) => result(() => researchDomainOperation(domain, operation, args, access(project_id), signal)));
    }
  }
}
