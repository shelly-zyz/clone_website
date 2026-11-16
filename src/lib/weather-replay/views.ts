export const replayViews = {
  weather: { title: "云雨叠加", description: "区域云体与连续雨幕，垂直形态为可视化重建" },
  time: { title: "降水时空层", description: "按档案间隔分层，体素颜色表示降水率" },
  rain: { title: "降雨粒子", description: "以连续雨幕和下沉微粒显示降水强度" },
  accumulation: { title: "累计降水", description: "从回放起点积分至当前时刻，查看累计热点" },
} as const;

export type ReplayView = keyof typeof replayViews;
export const weatherVolumeViews = {
  radar: { title: "三维雷达", description: "体扫回波、垂直剖面和真实高度切片" },
  wind: { title: "三维风场", description: "模式风矢量与区域 10 米风速预报" },
} as const;

export type VolumeView = keyof typeof weatherVolumeViews;
export type WeatherScene = "globe" | ReplayView | VolumeView;
export const weatherSceneViews = { ...replayViews, ...weatherVolumeViews };
export function isReplayView(view: WeatherScene): view is ReplayView {
  return Object.hasOwn(replayViews, view);
}
export const replayViewOrder = ["weather", "time", "rain", "accumulation"] as const satisfies readonly ReplayView[];
