export const replayViews = {
  weather: { title: "云雨叠加", description: "红外亮温和同一时段的降水率" },
  time: { title: "降水时空层", description: "每层间隔 30 分钟，追踪雨带移动" },
  rain: { title: "降雨粒子", description: "粒子密度随降水率增加，落点为动画示意" },
  accumulation: { title: "累计降水", description: "从回放起点积分至当前时刻，查看累计热点" },
} as const;

export type ReplayView = keyof typeof replayViews;
export type WeatherScene = "globe" | ReplayView;
export const replayViewOrder = ["weather", "time", "rain", "accumulation"] as const satisfies readonly ReplayView[];
