import type { WorkspaceTopic } from "@/lib/globe-topics";
import type { AnalysisTopic } from "@/lib/topic-analysis/catalog";

type IntroChapter = {
  title: readonly [string, string];
  description: string;
  shortTitle: string;
  source: string;
  sourceUrl: string;
  views: readonly [AnalysisTopic, AnalysisTopic];
  center: readonly [longitude: number, latitude: number];
  handoffCenter: readonly [longitude: number, latitude: number];
  night: number;
  particleColor: string;
};

export const introChapters = {
  power: {
    title: ["读懂电力", "的版图"],
    description: "从电源和电网设施出发，查看不同地区的装机、发电结构与月度变化。",
    shortTitle: "电源与发电",
    source: "© OpenStreetMap contributors · 中国电源点样本",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    views: ["power", "generation"],
    center: [97, 26],
    handoffCenter: [55, 24],
    night: 0.68,
    particleColor: "#ffe0a0",
  },
  weather: {
    title: ["追踪全球", "风场变化"],
    description: "查看近地面风速与风向，回放不同有效时刻的云雨和风场。",
    shortTitle: "风场与回放",
    source: "NOAA / NCEP GFS · 2014-01-31 03:00 UTC 归档",
    sourceUrl: "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast",
    views: ["weather", "renewables"],
    center: [116, 17],
    handoffCenter: [105, 22],
    night: 0.18,
    particleColor: "#9bf5e8",
  },
  carbon: {
    title: ["看见碳排放", "的分布"],
    description: "定位全球电力排放热点，沿日帧和统计时段查看变化。",
    shortTitle: "排放热点",
    source: "GRACED Power · 2025-08-15 日度格网样本",
    sourceUrl: "https://carbonmonitor-graced.com/datasets.html",
    views: ["carbon", "generation"],
    center: [25, 24],
    handoffCenter: [55, 24],
    night: 0.96,
    particleColor: "#c8fa86",
  },
  economy: {
    title: ["比较各地", "经济变化"],
    description: "比较经济体的 GDP、人均产出和出口，了解同版增长展望。",
    shortTitle: "规模与增长",
    source: "世界银行 WDI · 2024 年 GDP 样本",
    sourceUrl: "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD",
    views: ["economy", "outlook"],
    center: [69, 28],
    handoffCenter: [79, 22],
    night: 0.6,
    particleColor: "#ffc296",
  },
} as const satisfies Record<WorkspaceTopic, IntroChapter>;

export type IntroTopic = WorkspaceTopic | null;
