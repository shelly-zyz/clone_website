import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { dataQuerySchema, dataTopicSchema } from "@/lib/data-agent/contracts";
import { DataAgentError, readDataAgent } from "@/lib/data-agent/database.server";
import { authorizeDataAgent } from "@/lib/data-agent/http.server";
import { listDataCatalog, listDataEntities, queryData } from "@/lib/data-agent/query.server";
import { resolveDataResult } from "@/lib/data-agent/state.server";
import { inspectWeatherFile, listWeatherForecastRegions } from "@/lib/weather-model-forecast.server";
import { regionalWeatherModel, weatherRegionCode } from "@/lib/weather-model-forecast";
import { listWeatherReplays } from "@/lib/weather-replay/storage.server";

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
    description: "读取气象、电力、碳、经济专题的当前发布版本与审核指标。", inputSchema: z.strictObject({ topic: dataTopicSchema.optional() }),
  }, ({ topic }) => resultOf(() => listDataCatalog(topic)));
  server.registerTool("list_supplemental_catalog", {
    description: "只读查询四专题补充数据及各指标的单位、地区键、聚合、缺测和查询状态。",
    inputSchema: z.strictObject({ topic: dataTopicSchema.optional(), dataset_id: z.string().min(1).max(80).optional() }),
  }, ({ topic, dataset_id: datasetId }) => resultOf(() => readDataAgent(async (client) => {
    const { rows: [catalog] } = await client.query<{ installed: boolean; metric_catalog: boolean }>(
      `SELECT to_regclass('semantic.supplemental_dataset_catalog') IS NOT NULL AS installed,
        to_regclass('semantic.supplemental_metric_catalog') IS NOT NULL AS metric_catalog`,
    );
    if (!catalog.installed) return { status: "not_installed", datasets: [], metrics: [] };
    const selection = "WHERE ($1::text IS NULL OR topic_id = $1) AND ($2::text IS NULL OR dataset_id = $2)";
    const params = [topic ?? null, datasetId ?? null];
    const { rows } = await client.query(`
      SELECT topic_id, dataset_id, source_version, title, source_url, license_note, source_sha256,
             row_count, semantics, review_status
      FROM semantic.supplemental_dataset_catalog
      ${selection}
      ORDER BY topic_id, dataset_id, source_version, source_sha256`, params);
    const metrics = catalog.metric_catalog ? (await client.query(`
      SELECT * FROM semantic.supplemental_metric_catalog
      ${selection} ORDER BY topic_id, dataset_id, source_version, metric_code`, params)).rows : [];
    return { status: "ok", datasets: rows, metrics };
  })));
  server.registerTool("list_published_entities", {
    description: "在已发布版本中按地区名称或代码查找城市、经济体和其他查询实体。",
    inputSchema: z.strictObject({ topic: dataTopicSchema, dataset_id: z.string().min(1).max(80),
      search: z.string().trim().min(2).max(80), version: z.string().regex(/^[0-9a-f]{64}$/).optional() }),
  }, ({ topic, dataset_id: datasetId, search, version }) =>
    resultOf(async () => ({ entities: await listDataEntities(topic, datasetId, search, version) })));
  server.registerTool("list_weather_replays", {
    description: "只读核对已发布的 SatWeave 和 PARDIG 气象回放，包括来源、版本、时间窗、帧数及最大降水率。",
    inputSchema: z.strictObject({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).optional() }),
  }, ({ id }) => resultOf(() => listWeatherReplays(id)));
  server.registerTool("inspect_weather_file", {
    description: "按入库批次 UUID 读取已登记气象文件的格式、SHA-256、变量、时间和审核状态。",
    inputSchema: z.strictObject({ batch_id: z.uuid() }),
  }, ({ batch_id }) => resultOf(() => inspectWeatherFile(batch_id)));
  server.registerTool("list_weather_forecast_regions", {
    description: "读取 WRF 和 ClimaX 已发布的地区和对应模型。",
    inputSchema: z.strictObject({}),
  }, () => resultOf(listWeatherForecastRegions));
  server.registerTool("query_published_weather_forecast", {
    description: "只读查询已发布的区域 WRF 或 ClimaX 10 米风速，有效时间、起报、覆盖和来源随数据返回。",
    inputSchema: z.strictObject({
      model: regionalWeatherModel, region_code: weatherRegionCode, issue_time: z.iso.datetime({ offset: true }).optional(),
      version: z.string().regex(/^[0-9a-f]{64}$/).optional(), limit: z.number().int().min(1).max(120).optional(),
    }),
  }, (input) => resultOf(() => queryData(dataQuerySchema.parse({ topic: "meteo", ...input }))));
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
