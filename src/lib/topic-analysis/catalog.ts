import type { WorkspaceTopic } from "@/lib/globe-topics";

export const analysisTopics = {
  power: {
    label: "电力结构",
    title: "电源装机与发电结构",
    description: "追踪各类电源的装机扩张，比较风电、光伏与传统电源的占比。",
    globe: "power",
    color: "#156e72",
  },
  generation: {
    label: "发电季节性",
    title: "月度发电与省际比较",
    description: "用月度热力图观察发电高峰，比较同一月份各省的发电量。",
    globe: "power",
    color: "#246591",
  },
  fuels: {
    label: "煤油气供给",
    title: "煤、油、气生产",
    description: "比较原煤、原油和天然气的多年产量、增速及月度变化。",
    globe: "power",
    color: "#a1532f",
  },
  weather: {
    label: "近地面风场",
    title: "全球近地面风场",
    description: "用风向玫瑰图、风速分布和纬度对照阅读 GFS 归档预报。",
    globe: "weather",
    color: "#31719a",
  },
  renewables: {
    label: "风光气候情景",
    title: "风光资源与季节互补",
    description: "探索 2021–2060 年气候情景下全国与各省的风光容量因子。",
    globe: "weather",
    color: "#147768",
  },
  carbon: {
    label: "电力碳排放",
    title: "电力部门碳排放",
    description: "沿时间和纬度查看全球排放速率与非零排放格点。",
    globe: "carbon",
    color: "#a35239",
  },
  economy: {
    label: "经济规模",
    title: "全球经济规模与人均产出",
    description: "在世界地图、规模排行与长期趋势间切换，比较不同经济体。",
    globe: "economy",
    color: "#4f64a0",
  },
  trade: {
    label: "出口与开放度",
    title: "出口格局与贸易开放度",
    description: "比较出口规模、出口占 GDP 比重以及各经济体的变化。",
    globe: "economy",
    color: "#326e91",
  },
  outlook: {
    label: "增长展望",
    title: "全球经济增长展望",
    description: "用世界银行同一版预测比较各经济体的实际 GDP 增长路径。",
    globe: "economy",
    color: "#6d579a",
  },
} as const satisfies Record<string, {
  label: string;
  title: string;
  description: string;
  globe: WorkspaceTopic;
  color: string;
}>;

export type AnalysisTopic = keyof typeof analysisTopics;

export const analysisGroups = [
  { id: "energy", label: "电力与能源", topics: ["power", "generation", "fuels"] },
  { id: "climate", label: "气象与气候", topics: ["renewables", "weather"] },
  { id: "emissions", label: "碳排放", topics: ["carbon"] },
  { id: "economics", label: "经济与贸易", topics: ["economy", "trade", "outlook"] },
] as const satisfies readonly { id: string; label: string; topics: readonly AnalysisTopic[] }[];

export const analysisTopicOrder = Object.keys(analysisTopics) as AnalysisTopic[];

export function analysisHref(topic: AnalysisTopic) {
  return "/visualization/" + topic;
}
