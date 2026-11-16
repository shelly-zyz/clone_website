export type Finding = { label: string; text: string };

export function dataStory(headline: string, structure: string, relationship: string, evidence: string, highlights: Finding[] = []) {
  return {
    highlights: [{ label: "核心发现", text: headline }, ...highlights].slice(0, 3),
    sections: [
      { label: "核心发现", text: headline },
      { label: "结构与趋势分析", text: structure },
      { label: "关联分析", text: relationship },
      { label: "结论与依据", text: evidence },
    ],
  };
}

export type DataStory = ReturnType<typeof dataStory>;

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export const reading = (value: number, unit = "") => `${number.format(value)}${unit === "%" ? unit : unit ? ` ${unit}` : ""}`;
export const difference = (value: number, unit: string) => Math.abs(value) < 0.005 ? "基本持平"
  : `${value > 0 ? "增加" : "减少"} ${reading(Math.abs(value), unit)}`;

function quantile(sorted: number[], probability: number) {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

// The current value is held out. A flat or small reference sample cannot support an alert.
export function unexpectedValue(current: number, baseline: readonly number[]) {
  if (baseline.length < 4) return;
  const sorted = baseline.toSorted((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const spread = q3 - q1;
  if (spread === 0) return;
  const lower = q1 - 1.5 * spread;
  const upper = q3 + 1.5 * spread;
  if (current < lower || current > upper) return { lower, upper, direction: current < lower ? "低于" : "高于" };
}
