import type { DashboardQueryContext, EnergyDataset, EnergyIR, EnergyTechnology } from "./schema";

type GroundingOutcome =
  | { status: "grounded"; ir: EnergyIR }
  | { status: "clarification" | "unavailable" | "refused"; message: string; reasonCode: string };

const provinceAliases: Record<string, string> = Object.fromEntries([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "台湾", "香港", "澳门",
].map((name) => [name, name]));

const technologyAliases: Array<[EnergyTechnology, string[]]> = [
  ["solar", ["光伏", "太阳能"]], ["offshore", ["海上风电"]], ["wind", ["风电", "风力"]],
  ["hydro", ["水电", "水力"]], ["nuclear", ["核电"]], ["coal", ["煤电", "燃煤"]],
  ["gas", ["燃气", "气电"]], ["oil", ["燃油"]], ["geothermal", ["地热"]],
];

const datasetAliases: Array<[EnergyDataset, string[]]> = [
  ["gfs", ["gfs", "气象场", "天气预报"]], ["graced", ["graced", "碳排放栅格"]],
  ["vre", ["vre", "长期情景"]], ["osm", ["osm", "电网快照", "众包电网"]],
  ["pv-footprint", ["pv遥感", "遥感足迹", "光伏足迹"]], ["mapped-assets", ["映射设施", "设施数据集", "能源设施"]],
];

const writeTokens = ["删除", "写入", "修改", "新增", "插入", "drop ", "delete ", "update ", "insert ", "执行sql", "select *"];
const predictionTokens = ["15分钟预测", "发电预测", "调度方案", "实时省级碳强度", "实时碳强度"];

export function groundEnergyQuestion(question: string, context: DashboardQueryContext = {}): GroundingOutcome {
  const normalized = question.trim();
  const lower = normalized.toLowerCase();
  if (!normalized) return clarification("请输入一个能源数据问题。", "empty-question");
  if (writeTokens.some((token) => lower.includes(token)) || /更新.+为/.test(normalized)) {
    return { status: "refused", message: "首版只允许受控只读分析，不能执行写入、删除、更新或自由 SQL。", reasonCode: "read-only-policy" };
  }
  if (predictionTokens.some((token) => lower.includes(token))) {
    return { status: "unavailable", message: "该问题超出第八步首版范围；生产预测、调度和实时省级碳强度仍受数据门禁锁定。", reasonCode: "out-of-slice" };
  }

  const province = findProvince(normalized) ?? contextualProvince(normalized, context);
  const technology = findTechnology(normalized);
  const dataset = findDataset(lower) ?? contextualDataset(normalized, context);
  const entities: EnergyIR["entities"] = { country: "CN", ...(province ? { province } : {}), ...(technology ? { technology } : {}), ...(dataset ? { dataset } : {}) };

  if ((normalized.includes("该省") || normalized.includes("当前省份")) && !province) return clarification("请先选择省份，或在问题中写明省份。", "province-required");
  if ((normalized.includes("这个图层") || normalized.includes("该图层")) && !dataset) return clarification("请先选择图层，或写明 GFS、GRACED、VRE、OSM 或 PV 足迹。", "layer-required");

  if (dataset === "gfs" && /什么时间|起报|有效时间/.test(normalized)) {
    return grounded("gfs_run_time", entities, "current", "table");
  }
  if (dataset && /可用|是否|覆盖|图层|状态/.test(normalized) && !/更新时间|缺失|时间范围|哪些年份|数据质量/.test(normalized)) {
    return grounded("layer_availability", entities, "current", "status");
  }
  if (dataset && /时间|更新|缺失|质量|年份|范围/.test(normalized)) {
    return grounded("dataset_quality", entities, /最近|当前/.test(normalized) ? "latest" : "none", "table");
  }
  if (/来源|数据源|数据身份/.test(normalized) && (/设施|项目|电站|样本/.test(normalized) || technology)) {
    return grounded("mapped_asset_sources", entities, "none", "table");
  }
  if (/多少|数量|几个|多少个/.test(normalized) && (/设施|项目|电站|样本/.test(normalized) || technology)) {
    return grounded("mapped_asset_count", entities, "none", "number");
  }
  if (/最近|近期/.test(normalized)) return clarification("“最近”缺少明确的数据集和时间口径，请说明要查询的数据集与时间范围。", "ambiguous-time");
  return clarification("首版支持设施数量/来源、数据集时间与缺失状态，以及 GFS、GRACED、VRE、OSM、PV 图层可用性。请把问题限定到其中一类。", "unsupported-or-ambiguous");
}

function grounded(metric: EnergyIR["metric"], entities: EnergyIR["entities"], timeMode: EnergyIR["time"]["mode"], visualization: EnergyIR["visualization"]): GroundingOutcome {
  return { status: "grounded", ir: { schemaVersion: 1, operation: "read", intent: metric, metric, entities, time: { mode: timeMode }, groupBy: metric === "mapped_asset_sources" ? ["source"] : [], visualization, availabilityRequired: true } };
}

function clarification(message: string, reasonCode: string): GroundingOutcome {
  return { status: "clarification", message, reasonCode };
}

function findProvince(question: string) {
  return Object.keys(provinceAliases).find((name) => question.includes(name));
}

function contextualProvince(question: string, context: DashboardQueryContext) {
  if (!/该省|当前省份|这里/.test(question) || !context.selectedProvince || context.selectedProvince === "全国") return undefined;
  return provinceAliases[context.selectedProvince] ?? context.selectedProvince;
}

function findTechnology(question: string) {
  for (const [technology, aliases] of technologyAliases) if (aliases.some((alias) => question.includes(alias))) return technology;
  return undefined;
}

function findDataset(question: string) {
  for (const [dataset, aliases] of datasetAliases) if (aliases.some((alias) => question.includes(alias))) return dataset;
  return undefined;
}

function contextualDataset(question: string, context: DashboardQueryContext): EnergyDataset | undefined {
  if (!/这个图层|该图层/.test(question) || !context.selectedLayer) return undefined;
  const mapping: Record<string, EnergyDataset> = { "osm-power": "osm", "gfs-weather": "gfs", "graced-power": "graced", "vre-scenario": "vre", "pv-footprint": "pv-footprint" };
  return mapping[context.selectedLayer];
}
