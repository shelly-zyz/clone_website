export const globeTopics = {
  power: { title: "电源地球", label: "电力地球" },
  weather: { title: "气象地球", label: "气象地球" },
  carbon: { title: "碳排放地球", label: "碳排放地球" },
  economy: { title: "经济地球", label: "经济地球" },
};

export type WorkspaceTopic = keyof typeof globeTopics;

export const globeTopicOrder = ["power", "weather", "carbon", "economy"] as const satisfies readonly WorkspaceTopic[];

export function resolveWorkspaceTopic(value: unknown): WorkspaceTopic {
  return globeTopicOrder.find((topic) => topic === value) ?? "power";
}

export function workspaceHref(topic: WorkspaceTopic) {
  return topic === "power" ? "/workspace" : `/workspace?topic=${topic}`;
}
