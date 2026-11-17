import { VisualizationError, type FigureDesign, type FigureStyle } from "./contracts";

const categorical = ["#17688d", "#a23b65", "#39795b", "#a1651f", "#6855a2", "#4a6575"];
const base = {
  background: "#ffffff", foreground: "#22354a", muted: "#50667c", grid: "#e3eaf0", colors: categorical,
  continuous: ["#e7f1f6", "#76b1c9", "#166489", "#183653"],
  diverging: ["#3c69a5", "#f8fafc", "#b2445b"],
};
const themeColors = {
  "academic-light": base,
  "academic-monochrome": { ...base, foreground: "#232323", muted: "#545454", grid: "#e0e0e0",
    colors: ["#141414", "#4c4c4c", "#727272", "#313131", "#5c5c5c", "#222222"],
    continuous: ["#f4f4f4", "#999999", "#252525"], diverging: ["#1f1f1f", "#ffffff", "#666666"] },
  "editorial-modern": { ...base, background: "#ffffff", colors: ["#2a6786", "#a35373", "#447a71", "#886526", "#685d9d", "#4a6376"] },
  "scientific-spectrum": { ...base, colors: ["#3c518b", "#a44980", "#008274", "#945927", "#395a78", "#78597f"] },
  "dashboard-glass": { ...base, background: "#f1f6fa", colors: ["#32698d", "#945478", "#328073", "#925d35", "#6758a9", "#465c73"] },
  "dark-analytics": { background: "#142033", foreground: "#edf4fb", muted: "#b6cada", grid: "#354761",
    colors: ["#8ecae8", "#e7a5c2", "#8cd4b4", "#e2bc7d", "#c3b8ee", "#8fbdcb"],
    continuous: ["#263450", "#528dac", "#bfd8e9"], diverging: ["#679ed5", "#243348", "#e88c96"] },
} as const;

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function figureDesign(style: FigureStyle | undefined, paper: boolean): FigureDesign {
  const theme = style?.theme ?? (paper ? "academic-light" : "editorial-modern");
  const tokens = themeColors[theme];
  if (paper && theme !== "academic-light" && theme !== "academic-monochrome") {
    throw new VisualizationError("INCOMPATIBLE", "论文图件请选择科研白底或灰度主题。");
  }
  if (style?.accent && (theme === "academic-monochrome" && !/^#([a-f0-9]{2})\1\1$/i.test(style.accent) ||
      contrast(style.accent, tokens.background) < 3)) {
    throw new VisualizationError("VALIDATION_FAILED", "强调色与当前图件背景的对比度不足，或不符合灰度主题。");
  }
  return { ...tokens, colors: [style?.accent ?? tokens.colors[0], ...tokens.colors.slice(1)],
    continuous: [...tokens.continuous], diverging: [...tokens.diverging], theme,
    font: style?.font ?? "Arial", font_size: style?.font_size ?? (paper ? 8 : 11), legend: style?.legend ?? "bottom",
    width_mm: style?.width_mm ?? 183, height_mm: style?.height_mm ?? (paper ? 114 : 132),
    line_patterns: ["solid", "dash", "dot", "dash", "dot", "solid"] };
}
