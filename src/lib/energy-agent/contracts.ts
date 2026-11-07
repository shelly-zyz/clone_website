export const energyTechnologies = {
  coal: "煤电", gas: "燃气", geothermal: "地热", hydro: "水电", nuclear: "核电",
  offshore: "海上风电", oil: "燃油", solar: "光伏", wind: "陆上风电",
} as const;

export type EnergyTechnology = keyof typeof energyTechnologies;
export type EnergyMetric = "records" | "capacity";
export type EnergyEvidenceTopic = "map" | "tianji";

export function isEnergyTechnology(value: unknown): value is EnergyTechnology {
  return typeof value === "string" && Object.hasOwn(energyTechnologies, value);
}

export type EnergyRow = {
  technology: EnergyTechnology;
  records: number;
  capacityMw: number;
  sources: string[];
};

export type EnergyDataRef = {
  datasetId: "china-mapped-energy-assets";
  version: string;
  origin: "postgres" | "repository-snapshot";
  scope: "中国地图设施样本";
  technology: EnergyTechnology | "all";
  sources: string[];
  limitation: string;
};

export type EnergyVisualizationSpec = {
  metric: EnergyMetric;
  title: string;
  renderer: "mcp-echarts" | "local-echarts";
  dataVersion: string;
  option: Record<string, unknown>;
};

export type EnergyResultRef = {
  dataVersion: string;
  totalRecords: number;
  totalCapacityMw: number;
  largestGroup?: EnergyTechnology;
  largestShare?: number;
};

export type EnergyEvidenceRef = {
  id: string;
  title: string;
  explanation: string;
  url?: string;
};

export type EnergyTrace = {
  module: "总管" | "数据" | "可视化" | "分析" | "知识";
  tool: string;
  status: "ok" | "fallback" | "unavailable";
  detail: string;
};

export type EnergyResponse = {
  mode: "pi" | "built-in";
  answer: string;
  trace: EnergyTrace[];
  data?: { ref: EnergyDataRef; rows: EnergyRow[] };
  visualization?: EnergyVisualizationSpec;
  analysis?: EnergyResultRef;
  evidence?: EnergyEvidenceRef[];
};

export const energyExamples = [
  "按技术类型统计中国能源设施地图样本的记录数，画柱状图，给出样本最多的类型和占比，并解释数据来源。",
  "对比各技术类型的地图样本容量字段合计，用柱状图展示。",
  "地图上的设施样本数量为什么和官方统计不同？",
  "远景天机和 Arcana 是什么？哪些气象预测数据可以接入能源板块？",
];
