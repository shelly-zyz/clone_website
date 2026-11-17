export const replayViews = {
  weather: { title: "云雨叠加", description: "区域云层与降雨粒子叠加，粒子密度表示雨势" },
  time: { title: "降水时空层", description: "按档案间隔分层，体素颜色表示降水率" },
  rain: { title: "降雨粒子", description: "降水率决定粒子密度，雨滴沿垂直方向下落" },
  accumulation: { title: "累计降水", description: "从回放起点积分至当前时刻，查看累计热点" },
} as const;

export type ReplayView = keyof typeof replayViews;
export type WeatherScene = "globe" | ReplayView;
export const replayViewOrder = ["weather", "time", "rain", "accumulation"] as const satisfies readonly ReplayView[];
