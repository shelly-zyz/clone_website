export const replayViews = {
  weather: { title: "云雨叠加", description: "红外亮温与降雨粒子叠加，粒子密度表示雨势" },
  time: { title: "降水时空层", description: "每 30 分钟一层，体素颜色表示降水率" },
  rain: { title: "降雨粒子", description: "降水率决定粒子密度，雨滴沿垂直方向下落" },
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
