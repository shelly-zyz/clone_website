export const replayViews = {
  weather: { title: "云雨结构", description: "沿剖线对照云场与地面降水，云体高度为示意" },
  time: { title: "降水时空演变", description: "以 UTC 时间为竖轴，查看雨带在各时刻的空间分布" },
  rain: { title: "降水热点追踪", description: "从连续帧识别强降水区，沿轨迹查看中心位置和强度" },
  accumulation: { title: "累计降水", description: "在地图上比较累计雨量、等值线和覆盖面积" },
} as const;

export type ReplayView = keyof typeof replayViews;
export type WeatherScene = "globe" | ReplayView;
export const replayViewOrder = ["weather", "time", "rain", "accumulation"] as const satisfies readonly ReplayView[];
