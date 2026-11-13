import type { WorkspaceTopic } from "@/lib/globe-topics";

export const analysisTopics = {
  power: {
    label: "电力",
    title: "电力结构与发电",
    description: "比较全国各类电源的装机容量和发电量，观察装机结构的变化。",
    preview: "全国电源装机结构",
    color: "#9a5e13",
  },
  weather: {
    label: "气象",
    title: "全球近地面风场",
    description: "用一帧 GFS 历史预报，查看纬度、风速区间和风向分布。",
    preview: "纬度带平均风速",
    color: "#197589",
  },
  carbon: {
    label: "碳排放",
    title: "电力部门碳排放",
    description: "查看 GRACED 的日度排放速率、纬度分布和非零排放格点。",
    preview: "全球电力排放速率",
    color: "#3f7855",
  },
  economy: {
    label: "经济",
    title: "经济规模与增长展望",
    description: "按国家或地区查看 GDP、人均 GDP、出口额和实际增长预测。",
    preview: "中国 GDP 历年变化",
    color: "#a25445",
  },
} as const satisfies Record<WorkspaceTopic, {
  label: string;
  title: string;
  description: string;
  preview: string;
  color: string;
}>;

export function analysisHref(topic: WorkspaceTopic) {
  return "/visualization/" + topic;
}
