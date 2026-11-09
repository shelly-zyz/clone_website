import { datasets, type MetricRules, type PublishedMetric } from "./contracts";

// Keep v1 attached to matching historical snapshots. A change of meaning needs a new rule ID.
const powerRules = {
  electricity_generation_current: {
    period: "monthly_value", unit: "亿千瓦时", sourceMetric: "current", forecast: "same_series",
    interpretation: "来源发布的月度本期值。1—2 月缺测保留为空，合报不拆月。全国、各省和不同电源分别解释。",
  },
  electricity_generation_cumulative: {
    period: "year_to_date", unit: "亿千瓦时", sourceMetric: "cumulative", forecast: "unsupported",
    interpretation: "年初至本月累计值，跨年重置。各月累计值覆盖重叠月份，不可直接相加。",
  },
  electricity_generation_yoy: {
    period: "monthly_yoy", unit: "%", sourceMetric: "yoy", forecast: "same_series",
    interpretation: "来源发布的本期同比增长率。各月百分比不可直接相加，也不可当作发电量。",
  },
  electricity_generation_cumulative_yoy: {
    period: "year_to_date_yoy", unit: "%", sourceMetric: "cumulative-yoy", forecast: "unsupported",
    interpretation: "来源发布的年初至本月累计同比增长率，比较窗口随月份变化且跨年重置。",
  },
} as const satisfies Record<string, Pick<MetricRules, "period" | "forecast" | "interpretation"> & { unit: string; sourceMetric: string }>;

export function withMetricRules(datasetId: string, metric: PublishedMetric): PublishedMetric {
  if (metric.rules) return metric;
  const policy = { aggregation: "published_values_only", missing: "preserve_null" } as const;
  if (datasetId === datasets.carbon && metric.metric_code === "global_grid_emission_rate_sum"
    && metric.unit === "kgC/h" && metric.time_grain === "day" && metric.data_identity === "research_estimate") {
    return { ...metric, rules: { ...policy, id: "graced.power-rate.v1", period: "daily_rate", forecast: "same_series",
      lineage: "carbon.carbon_emission_frames.sum_kgc_per_hour，按 Power 部门和档案版本发布",
      interpretation: "每个日帧内全球格点的速率合计。跨日直接求和不能得到排放量，图表和预测保持 kgC/h。" } };
  }
  if (datasetId !== datasets.power || metric.time_grain !== "month" || metric.data_identity !== "official_statistics"
    || !Object.hasOwn(powerRules, metric.metric_code)) return metric;
  const rule = powerRules[metric.metric_code as keyof typeof powerRules];
  if (metric.unit !== rule.unit) return metric;
  return { ...metric, rules: { ...policy, id: `nbs.${rule.sourceMetric}.v1`, period: rule.period,
    forecast: rule.forecast, interpretation: rule.interpretation,
    lineage: `website_data.nbs_energy_monthly[${rule.sourceMetric}] 或审核发布的统计局月报原值` } };
}
