export const researchColors = {
  lavender: { base: "#9698c9", light: "#d7d6ee", ink: "#5d6193" },
  ice: { base: "#91b7d5", light: "#d6e8f3", ink: "#416d8d" },
  mint: { base: "#87c5c0", light: "#d3eeea", ink: "#367b76" },
  sage: { base: "#b9d5b3", light: "#e1efdb", ink: "#50764b" },
  champagne: { base: "#ead39d", light: "#f7ebcd", ink: "#826426" },
  rose: { base: "#dcadbd", light: "#f2dbe4", ink: "#903e60" },
} as const;

export type ResearchColor = keyof typeof researchColors;

export const researchInk = "#263442";
export const researchRule = "#e5ebf0";

export const verticalFill = (top: string, bottom: string) => ({
  type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
  colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }],
});

export function interpolateColor(start: string, end: string, ratio: number) {
  const t = Math.min(1, Math.max(0, ratio));
  return `#${[1, 3, 5].map(offset => {
    const a = Number.parseInt(start.slice(offset, offset + 2), 16);
    const b = Number.parseInt(end.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
  }).join("")}`;
}
