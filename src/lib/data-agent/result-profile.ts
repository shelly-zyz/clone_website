import type { queryData } from "./query.server";
import { withMetricRules } from "./metric-rules";

export type DataResult = Awaited<ReturnType<typeof queryData>>;

function nextDate(time: number, grain: string) {
  const date = new Date(time);
  if (grain === "month") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
  } else {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.getTime();
}

export function profileDataResult({ metric: snapshot, rows, data_ref, query }: DataResult) {
  const metric = withMetricRules(data_ref.dataset_id, snapshot);
  const category = data_ref.shape === "category" || ("province_comparison" in query && query.province_comparison === true);
  const historical = !category && metric.data_identity !== "forecast" && ["day", "month"].includes(metric.time_grain);
  const shape = category ? "category" : rows.length === 1 ? "scalar" : "time_series";
  const values = new Set<number>();
  let valid = 0;
  let continuous = 0;
  let last = NaN;
  let invalid = false;
  for (const row of rows) {
    const time = Date.parse(row.time_start);
    if (row.value === null) {
      continuous = 0;
      continue;
    }
    const value = Number(row.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) {
      invalid = true;
      continue;
    }
    values.add(value);
    valid++;
    continuous = continuous > 0 && nextDate(last, metric.time_grain) === time ? continuous + 1 : 1;
    last = time;
  }
  const hasValues = !invalid && valid > 0;
  const forecast = hasValues && historical && metric.rules?.forecast !== "unsupported" && continuous >= 8;
  return {
    shape, dimensions: { x: category ? "entity_code" : "time_start", value: "value", timeGrain: metric.time_grain },
    metric, query, coverage: data_ref.time_range, quality: data_ref.quality,
    valid, invalid, continuous: historical ? continuous : null, historical,
    chart: hasValues ? category ? { types: ["bar"], default: "bar" as const } : { types: valid > 1 ? ["line", "bar"] : ["bar", "line"], default: valid > 1 ? "line" as const : "bar" as const } : null,
    analysis: {
      describe: hasValues,
      maxClusters: hasValues ? Math.min(5, values.size) : 0,
      forecast,
      maxHoldout: forecast ? Math.min(12, continuous - 8) : 0,
    },
  };
}
