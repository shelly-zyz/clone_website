import "server-only";

import { energyTechnologies, isEnergyTechnology, type EnergyEvidenceTopic, type EnergyMetric, type EnergyResponse, type EnergyResultRef, type EnergyTechnology } from "./contracts";
import { energyCatalog, queryEnergyData } from "./data.server";
import { buildEnergyChart, readEnergyEvidence } from "./mcp.server";
import { energyPiConfig, piTool, runPiAgent, type EnergyPiConfig } from "./pi.server";

type EnergyRequest = { question: string; technology: EnergyTechnology | "all" };
const catalogPrompt = "当前唯一数据集是中国地图设施样本，支持按技术分类和记录数、容量字段合计。它包含多来源和混合状态。省市、日期、运行状态、实际发电、官方装机和预测暂未纳入。禁止生成 SQL 或执行写入。";

function createRun(mode: EnergyResponse["mode"], technology: EnergyRequest["technology"]) {
  const response: EnergyResponse = { mode, answer: "", trace: [] };
  const trace = response.trace;
  const catalog = async () => {
    trace.push({ module: "数据", tool: "search_energy_catalog", status: "ok", detail: "加载能源样本指标、范围和限制" });
    return energyCatalog;
  };
  const query = async () => {
    if (response.data) return response.data;
    const { ref, rows, databaseUnavailable } = await queryEnergyData(technology);
    response.data = { ref, rows };
    trace.push({ module: "数据", tool: "query_energy_metrics", status: databaseUnavailable ? "fallback" : "ok",
      detail: ref.origin === "postgres" ? "PostgreSQL · green_agent_ro 只读视图" : databaseUnavailable ? "数据库不可用，已读取仓库地图快照" : "仓库地图快照 · 固定聚合" });
    return response.data;
  };
  const chart = async (metric: EnergyMetric) => {
    if (!response.data) return { status: "query_required" };
    if (response.visualization?.metric === metric) return { renderer: response.visualization.renderer };
    const { rows, ref } = response.data;
    if (rows.length === 0) return { status: "empty" };
    const spec = await buildEnergyChart(rows, metric, ref.version);
    response.visualization = spec;
    trace.push({ module: "可视化", tool: "generate_bar_chart", status: spec.renderer === "mcp-echarts" ? "ok" : "fallback",
      detail: spec.renderer === "mcp-echarts" ? "mcp-echarts 返回并核对配置，网页用 ECharts 渲染" : "图表 MCP 未返回有效配置，网页用本地 ECharts 渲染" });
    return { title: spec.title, renderer: spec.renderer };
  };
  const analyse = async () => {
    if (!response.data) return { status: "query_required" };
    if (response.analysis) return response.analysis;
    const { ref, rows } = response.data;
    const result: EnergyResultRef = { dataVersion: ref.version, totalRecords: 0, totalCapacityMw: 0 };
    let largest = rows[0];
    for (const row of rows) {
      result.totalRecords += row.records;
      result.totalCapacityMw += row.capacityMw;
      if (row.records > largest.records) largest = row;
    }
    result.totalCapacityMw = Math.round(result.totalCapacityMw * 100) / 100;
    if (largest && result.totalRecords > 0) {
      result.largestGroup = largest.technology;
      result.largestShare = largest.records / result.totalRecords;
    }
    response.analysis = result;
    trace.push({ module: "分析", tool: "analyse_energy_mix", status: "ok", detail: "使用同一 DataRef 计算记录数、容量字段合计及样本占比" });
    return result;
  };
  const evidence = async (topic: EnergyEvidenceTopic) => {
    if (response.evidence) return response.evidence;
    response.evidence = await readEnergyEvidence(topic);
    trace.push({ module: "知识", tool: "get_energy_evidence", status: "ok", detail: "通过本地知识 MCP 读取已登记的口径和来源" });
    return response.evidence;
  };
  return { response, catalog, query, chart, analyse, evidence };
}

type EnergyRun = ReturnType<typeof createRun>;

function evidenceTopic(question: string): EnergyEvidenceTopic {
  return /天机|Arcana/i.test(question) ? "tianji" : "map";
}

async function databaseAgent(run: EnergyRun, config: EnergyPiConfig, question: string, signal?: AbortSignal) {
  const tools = [
    piTool("search_energy_catalog", "检索数据目录", "先读取数据集口径和可用指标", {}, run.catalog),
    piTool("query_energy_metrics", "读取能源样本", "执行只读固定聚合并返回 DataRef", {}, run.query),
  ];
  await runPiAgent(config, `你是能源数据库子智能体。${catalogPrompt} 先调用 search_energy_catalog，再调用 query_energy_metrics。只依赖工具。`, question, tools, 4, signal);
  if (!run.response.data) throw new Error("Database agent did not produce data");
  return run.response.data;
}

async function piWorkflow(run: EnergyRun, config: EnergyPiConfig, question: string, signal: AbortSignal) {
  const tools = [
    piTool("ask_energy_database", "委派数据库智能体", "查能源地图设施记录数或容量字段时调用", {}, async (_args, toolSignal) => {
      if (run.response.data) return run.response.data;
      run.response.trace.push({ module: "总管", tool: "ask_energy_database", status: "ok", detail: "Pi 总管委派给独立的 Pi 数据库智能体" });
      return databaseAgent(run, config, question, toolSignal ?? signal);
    }),
    piTool("make_energy_chart", "生成图表", "从本次已查询数据生成柱状图，metric 为 records 或 capacity", {
      metric: { type: "string", enum: ["records", "capacity"] },
    }, (args) => run.chart(typeof args === "object" && args !== null && "metric" in args && args.metric === "capacity" ? "capacity" : "records")),
    piTool("analyse_energy_mix", "计算能源样本统计", "计算记录总数、最大类型及其占比", {}, run.analyse),
    piTool("lookup_energy_evidence", "读取来源与口径", "回答地图样本定义，或查询远景天机、Arcana 可用资料", {}, () => run.evidence(evidenceTopic(question))),
  ];
  await runPiAgent(config, `你是 OpenGridWorks 的能源总管。${catalogPrompt}
先区分查询、作图、描述统计和知识问答。请求统计时必须委派数据库工具，请求绘图时查询后生成图表，请求占比时查询后分析，请求解释来源时调用知识工具。纯口径问题只调用知识。涉及尚未接入的筛选或数据时结束，不用近似结果替代。`, question, tools, 8, signal);
}

async function builtInWorkflow(run: EnergyRun, question: string) {
  const topic = evidenceTopic(question);
  const requestsEvidence = topic === "tianji" || /来源|口径|为什么|区别|不同|代表/.test(question);
  const requestsMetrics = /统计|画|柱状|多少|对比|最多|占比|分布|合计/.test(question);
  if (requestsMetrics && topic === "map") {
    await run.catalog();
    await run.query();
    await run.analyse();
    if (/图|对比/.test(question)) await run.chart(/容量/.test(question) ? "capacity" : "records");
  }
  if (requestsEvidence) await run.evidence(topic);
}

function finalize(run: EnergyRun, question: string): EnergyResponse {
  const { response } = run;
  if (response.data?.rows.length && /容量/.test(question)) {
    const rows = response.data.rows;
    const largest = rows.reduce((max, row) => row.capacityMw > max.capacityMw ? row : max);
    response.answer = `容量字段合计最大的类型是${energyTechnologies[largest.technology]}，样本记录的容量字段合计为 ${largest.capacityMw.toLocaleString("zh-CN")} MW。`;
  } else if (response.analysis && response.analysis.largestGroup && response.analysis.largestShare !== undefined) {
    const result = response.analysis;
    response.answer = `当前范围包含 ${result.totalRecords.toLocaleString("zh-CN")} 条地图设施记录。${energyTechnologies[response.analysis.largestGroup]}的记录数最多，占 ${new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(response.analysis.largestShare)}。`;
  } else if (response.data) {
    response.answer = response.data.rows.length ? `已查询 ${response.data.rows.length} 类能源设施地图样本，按数据来源和版本展示。` : "当前筛选没有可用的样本记录。";
  } else {
    response.answer = response.evidence?.map((item) => item.explanation).join(" ") ?? "当前可查中国能源设施地图样本的记录数、容量字段合计和数据口径。试一下上面的示例问题。";
  }
  return response;
}

let piActive = false;

export async function runEnergyRequest(input: EnergyRequest, signal: AbortSignal) {
  const queryRequest = evidenceTopic(input.question) === "map";
  const unsupported = /\b(?:delete|drop|truncate|insert|update)\b|删除|写入|新增表|执行\s*SQL/i.test(input.question) ||
    (queryRequest && /\d{4}|\d{1,2}月|省|市|自治区|在运|发电量|预测/.test(input.question));
  const matches = Object.entries(energyTechnologies)
    .filter(([, label]) => input.question.includes(label)).map(([key]) => key).filter(isEnergyTechnology);
  const mismatch = input.technology !== "all" && matches.some((match) => match !== input.technology);
  if (unsupported || mismatch || matches.length > 1) {
    return {
      mode: "built-in", trace: [{ module: "总管", tool: "scope_check", status: "unavailable", detail: "请求超出已发布的查询范围" }],
      answer: "目前支持查询中国地图样本的记录数或容量字段，技术范围可选全部或单项。请调整问题或下拉筛选。",
    } satisfies EnergyResponse;
  }
  const technology = input.technology === "all" ? matches[0] ?? "all" : input.technology;
  const config = energyPiConfig();
  let fallback = config ? "Pi 正在处理另一条请求，已使用固定工具流程" : "Pi 模型未启用，已使用固定工具流程";
  if (config && !piActive) {
    const run = createRun("pi", technology);
    piActive = true;
    try {
      await piWorkflow(run, config, input.question, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
      run.response.trace.unshift({ module: "总管", tool: "pi_router", status: "ok", detail: `Pi · ${config.model.id}` });
      return finalize(run, input.question);
    } catch {
      signal.throwIfAborted();
      fallback = "Pi 请求超时或未完成，已使用固定工具流程";
    } finally {
      piActive = false;
    }
  }
  const run = createRun("built-in", technology);
  run.response.trace.push({ module: "总管", tool: "built_in_router", status: "fallback", detail: fallback });
  await builtInWorkflow(run, input.question);
  return finalize(run, input.question);
}
