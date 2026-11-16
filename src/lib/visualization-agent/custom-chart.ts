import type { EChartsOption } from "echarts";
import type { DataResult } from "@/lib/data-agent/result-profile";
import { dataStory, difference, reading, unexpectedValue, type Finding } from "@/lib/topic-analysis/data-story";
import { researchColors, researchInk, researchRule, verticalFill } from "@/lib/topic-analysis/research-palette";
import type { CustomChart } from "./contracts";

type Point = { label: string; value: number | null };
const muted = "#50677c";

export function researchChart(custom: CustomChart, points: Point[], title: string, unit: string, axis: string, forecast: boolean): EChartsOption {
  const tone = researchColors[custom.palette];
  const axisLabel = { color: muted, hideOverlap: true, fontSize: 10 };
  const scale = { type: "value" as const, name: unit, nameTextStyle: { color: muted }, axisLabel,
    splitLine: { lineStyle: { color: researchRule } } };
  const base: EChartsOption = {
    animation: false, backgroundColor: "#ffffff", textStyle: { color: researchInk },
    title: { text: title, left: "center", top: 4, textStyle: { fontSize: 13, width: 260, overflow: "truncate" } },
    tooltip: { trigger: "axis", renderMode: "richText", confine: true, backgroundColor: "#ffffff", borderColor: researchRule },
  };
  if (custom.template === "rank") {
    const sorted = points.toSorted((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    return {
      ...base, grid: { left: 96, right: 58, top: 35, bottom: 46 },
      xAxis: { ...scale, nameLocation: "middle", nameGap: 26, axisLabel: { ...axisLabel, margin: 4 }, axisLine: { show: true, lineStyle: { color: researchRule } } },
      yAxis: { type: "category", inverse: true, data: sorted.map(point => point.label), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { ...axisLabel, width: 82, overflow: "truncate" } },
      tooltip: { ...base.tooltip, trigger: "item" },
      ...(sorted.length > 9 && { dataZoom: [
        { type: "inside", yAxisIndex: 0, startValue: 0, endValue: 8, zoomOnMouseWheel: false, moveOnMouseWheel: true },
        { type: "slider", yAxisIndex: 0, startValue: 0, endValue: 8, right: 7, width: 9, showDetail: false, showDataShadow: false,
          brushSelect: false, fillerColor: `${tone.base}64`, borderColor: researchRule },
      ] }),
      series: [
        { name: unit, type: "bar", data: sorted.map(point => point.value), barWidth: 1.5, silent: true, itemStyle: { color: tone.light } },
        { name: unit, type: "scatter", symbolSize: 12, encode: { x: 0, y: 1, tooltip: [0] }, data: sorted.flatMap(({ value, label }, index) =>
          value === null ? [] : [{ name: label, value: [value, index], label: { formatter: reading(value) }, tooltip: { formatter: `${label}：${reading(value, unit)}` } }]),
          itemStyle: { color: tone.base, borderColor: tone.ink, borderWidth: 1, opacity: 0.9 },
          label: { show: true, position: "right", fontSize: 10, color: researchInk },
        },
      ],
    };
  }
  const ribbon = custom.template === "ribbon";
  return {
    ...base,
    grid: { left: 58, right: 18, top: 57, bottom: 54 },
    xAxis: { type: "category", name: axis, nameLocation: "middle", nameGap: 31, nameTextStyle: { color: muted },
      axisLabel, boundaryGap: !ribbon, data: points.map(point => point.label), axisTick: { show: false }, axisLine: { lineStyle: { color: researchRule } } },
    yAxis: scale,
    series: ribbon ? [{
      type: "line", name: unit, data: points.map(point => point.value), connectNulls: false, showSymbol: points.length <= 40,
      symbol: "circle", symbolSize: 5, lineStyle: { color: tone.ink, type: forecast ? "dashed" : "solid", width: 2.1 },
      itemStyle: { color: tone.base, borderWidth: 1, borderColor: "#fff" }, areaStyle: { color: verticalFill(tone.base, `${tone.light}20`), opacity: 0.63 },
    }] : [{ type: "bar", name: unit, data: points.map(point => point.value), barMaxWidth: 26,
      itemStyle: { color: verticalFill(tone.base, tone.light), borderRadius: [3, 3, 0, 0] } }],
  };
}

function isFollowing(prior: string, value: string, grain: string) {
  const earlier = Date.parse(prior);
  const later = Date.parse(value);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return false;
  if (grain === "day") return later - earlier === 86_400_000;
  if (grain === "month") {
    const date = new Date(earlier);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 7) === value.slice(0, 7);
  }
  return false;
}

export function chartStory(result: DataResult, points: Point[], category: boolean) {
  const { metric, data_ref: ref } = result;
  const values = points.flatMap(({ label, value }) => value === null ? [] : [{ label, value }]);
  const first = values[0];
  const last = values.at(-1);
  const ordered = values.toSorted((a, b) => b.value - a.value);
  const highest = ordered[0];
  const forecast = metric.data_identity === "forecast" || metric.time_grain === "forecast_frame";
  const evidence = `${metric.source_name} · ${metric.definition}。有效 ${values.length} 条，结果中有 ${points.length - values.length} 条无数值。${ref.quality.truncated ? "查询结果已截断，文字仅描述返回部分。" : "按原发布单位展示。"}`;
  if (!first || !last) return dataStory("当前范围没有有效观测。", "暂无可比数值。", "需要同范围相关指标。", evidence);
  if (category) {
    const second = ordered[1];
    const detail = second ? `${highest.label}与${second.label}相差 ${reading(highest.value - second.value, metric.unit)}。` : "只有一个类别有值。";
    return dataStory(`返回的 ${ordered.length} 个有效类别中，${highest.label}的${metric.name}为 ${reading(highest.value, metric.unit)}，数值最高。`,
      detail, "这里只比较同一指标的类别值。贡献比例需要能够相加的分项和经确认的总量。", evidence,
      second ? [{ label: "类别对比", text: detail }] : []);
  }
  const highlights: Finding[] = [];
  const finalIndex = points.findLastIndex(point => point.value !== null);
  const previous = points[finalIndex - 1];
  const consecutive = previous && previous.value !== null && isFollowing(previous.label, last.label, metric.time_grain);
  const change = consecutive && previous.value !== null && !forecast
    ? `较 ${previous.label}${difference(last.value - previous.value, metric.unit)}。`
    : forecast ? "图中为已发布预报值。" : "缺少相邻可比期，未计算环比。";
  if (consecutive && !forecast) highlights.push({ label: "较上期变化", text: change });
  const baseline: number[] = [];
  if (!forecast && !ref.quality.truncated) {
    for (let i = finalIndex - 1; i >= 0 && points[i].value !== null && isFollowing(points[i].label, points[i + 1].label, metric.time_grain); i--) {
      const value = points[i].value;
      if (value !== null) baseline.unshift(value);
    }
  }
  const alert = unexpectedValue(last.value, baseline.length >= 8 ? baseline : []);
  if (alert) highlights.push({ label: "偏离历史参考范围", text: `最新值${alert.direction}前 ${baseline.length} 期的参考范围 ${reading(alert.lower)}–${reading(alert.upper, metric.unit)}。` });
  return dataStory(`${last.label} 的${metric.name}为 ${reading(last.value, metric.unit)}。${change}`,
    `${first.label} 至 ${last.label} 共 ${values.length} 个有效观测${forecast ? "（预报）" : ""}。${highest.label} 的值最高，为 ${reading(highest.value, metric.unit)}。`,
    "只有一个指标，尚不能识别关联因素。需要同范围、同粒度的其他指标或已审核资料。",
    `${evidence}${alert ? "参考范围使用先前观测的 1.5 倍四分位距，异常提示供核查。" : ""}`, highlights);
}
