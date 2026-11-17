import { difference, reading, unexpectedValue } from "@/lib/topic-analysis/data-story";
import type { DatasetPoint, FigureInsight } from "./contracts";
import type { Evidence } from "./planner";

function dateLabel(time: string, grain: string) {
  if (grain === "year") return time.slice(0, 4) + " 年";
  if (grain === "month") return time.slice(0, 7);
  if (grain === "day") return time.slice(0, 10);
  return time.slice(0, 16).replace("T", " ") + " UTC";
}

function adjacent(previous: string, current: string, grain: string) {
  const next = new Date(previous);
  if (grain === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (grain === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else if (grain === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else return false;
  return next.getTime() === Date.parse(current);
}

export function figureInsights(evidence: Evidence, statistics: Record<string, number>): FigureInsight[] {
  const findings: FigureInsight[] = [];
  evidence.forEach(({ data, profile }, index) => {
    const values = data.rows.filter((row): row is DatasetPoint & { value: number } => row.value !== null);
    const name = data.title;
    const unit = data.unit;
    const sources = [index];
    if (data.dimensions.shape === "time") {
      const grain = data.dimensions.time_grain;
      const ordered = values.toSorted((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
      const last = ordered.at(-1)!;
      const date = dateLabel(last.timestamp!, grain);
      const prior = ordered.at(-2);
      if (data.is_forecast) {
        const spread = last.bounds ? "，区间为 " + reading(last.bounds[0], unit) + " 至 " + reading(last.bounds[1], unit) : "，该期发布点值";
        findings.push({ label: "预测", text: name + "在 " + date + " 的预测值为 " + reading(last.value, unit) + spread + "。", sources });
      } else {
        const delta = prior && adjacent(prior.timestamp!, last.timestamp!, grain)
          ? "，较上一期" + difference(last.value - prior.value, unit === "%" ? "个百分点" : unit) : "";
        findings.push({ label: delta ? "时期变化" : "最近有效记录", text: name + "在 " + date + " 为 " + reading(last.value, unit) + delta + "。", sources });
        const baseline = ordered.slice(-25, -1);
        const unusual = baseline.every((point, i) => adjacent(point.timestamp!, (baseline[i + 1] ?? last).timestamp!, grain))
          ? unexpectedValue(last.value, baseline.map(row => row.value)) : undefined;
        if (unusual) findings.push({ label: "异常值筛查", text: name + "的最近记录" + unusual.direction + "此前 " + baseline.length +
          " 期四分位距筛查边界（" + reading(unusual.lower, unit) + " 至 " + reading(unusual.upper, unit) + "）。", sources });
      }
      return;
    }
    if (data.dimensions.shape === "category") {
      const highest = values.reduce((a, b) => a.value >= b.value ? a : b);
      findings.push({ label: "高值类别", text: name + "的最高公布值为" + highest.label + "的 " + reading(highest.value, unit) + "。", sources });
      return;
    }
    findings.push({ label: data.dimensions.shape === "grid" ? "网格范围" : "边权范围",
      text: name + "的 " + values.length + " 个有效值分布在 " + reading(profile.min, unit) + " 至 " + reading(profile.max, unit) + "。", sources });
  });
  if (typeof statistics.pearson_r === "number") findings.push({
    label: "相关分析", text: "按地区和有效时间配对后，Pearson r = " + reading(statistics.pearson_r) +
      "。这描述样本内的线性关系。", sources: evidence.map((_, index) => index),
  });
  return findings;
}
