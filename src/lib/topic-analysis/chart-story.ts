import { dataStory, difference, reading, unexpectedValue, type Finding } from "./data-story";
import { hasChartValues, type AnalysisChartSpec } from "./model";

type Entry = { label: string; value: number; index: number };

function entries(labels: readonly string[], values: readonly (number | null)[]) {
  return labels.flatMap((label, index) => {
    const value = values[index];
    return typeof value === "number" && Number.isFinite(value) ? [{ label, value, index }] : [];
  });
}

const extremes = (values: Entry[]) => values.reduce((best, item) => ({
  high: item.value > best.high.value ? item : best.high,
  low: item.value < best.low.value ? item : best.low,
}), { high: values[0], low: values[0] });

function comparisons(a: Entry, b: Entry, unit: string) {
  if (a.value === b.value) return a.label + "与" + b.label + "均为 " + reading(a.value, unit) + "。";
  return a.label + "为 " + reading(a.value, unit) + "，比" + b.label + (a.value > b.value ? "高 " : "低 ")
    + reading(Math.abs(a.value - b.value), unit === "%" ? "个百分点" : unit) + "。";
}

export function chartStory(spec: AnalysisChartSpec, unavailable?: string) {
  const missing = unavailable ?? "当前筛选范围暂无已发布数值。";
  if (!hasChartValues(spec)) return dataStory(missing, "有值记录才纳入趋势或排行。", "当前范围缺少可用的对照记录。", spec.caption);
  const write = (headline: string, structure: string, relationship: string, highlights: Finding[] = []) =>
    dataStory(headline, structure, relationship, spec.caption, highlights.length ? highlights : [{ label: "同图对照", text: relationship }]);

  if (spec.kind === "sankey") {
    const links = spec.links.filter(link => link.value > 0);
    const max = links.reduce((a, b) => a.value >= b.value ? a : b);
    const to = links.filter(link => link.target === max.target);
    return write(`${max.source}流向${max.target}的数值为 ${reading(max.value, spec.unit)}，在图示连线中最高。`,
      `图中有 ${links.length} 条有值连线，涉及 ${new Set(links.flatMap(link => [link.source, link.target])).size} 个节点。`,
      to.length > 1 ? `${max.target}有 ${to.length} 个图示来源，最大来项占该节点图示流入的 ${reading(max.value / to.reduce((total, link) => total + link.value, 0) * 100, "%")}。`
        : `${max.target}的图示流入来自${max.source}。`);
  }

  const [first, second] = spec.series;
  const fmt = (value: number) => reading(value, spec.unit);
  const firstValues = entries(spec.labels, first.values);
  const pair = second && entries(spec.labels, second.values);
  const forecast = spec.forecast ? "预测" : "";
  if (spec.kind === "rose") {
    const { high, low } = extremes(firstValues);
    const runner = firstValues.toSorted((a, b) => b.value - a.value)[1];
    return write(`${high.label}风对应的加权面积占比最高，为 ${fmt(high.value)}。`,
      `${low.label}风占比最低，为 ${fmt(low.value)}。共有 ${firstValues.length} 个有值方向。`,
      runner ? comparisons({ ...high, label: high.label + "风" }, { ...runner, label: runner.label + "风" }, spec.unit)
        : "当前仅有一个方向提供数值。");
  }
  if (spec.id === "province-comparison" || spec.id === "carbon-comparison") {
    const [a, b] = firstValues;
    if (firstValues.length === 1) {
      return write(`${a.label}为 ${fmt(a.value)}。`, "当前只有一组有效数值。", "两组均有值时可计算变化。");
    }
    return write(comparisons(b, a, spec.unit), `A 为 ${fmt(a.value)}，B 为 ${fmt(b.value)}。`,
      a.value > 0 ? `以 A 为基准，B 的相对变化为 ${reading((b.value - a.value) / a.value * 100, "%")}。` : "基准值为零或负值，仅报告绝对差。");
  }
  if (spec.kind === "bubble") {
    const points = firstValues.flatMap(({ index, label, value }) => {
      const y = second.values[index];
      return typeof y === "number" && Number.isFinite(y) ? [{ label, x: value, y }] : [];
    });
    if (!points.length) return write("两项指标缺少配对记录。", "气泡只绘制横轴和纵轴均有值的类别。", "当前没有足够的配对值用于说明两项指标。");
    const point = points.find(item => item.label === spec.focus) ?? points.reduce((a, b) => a.y >= b.y ? a : b);
    return write(`${point.label}的${first.name}为 ${reading(point.x, spec.xUnit)}，${second.name}为 ${fmt(point.y)}。`,
      `图中有 ${points.length} 个类别同时提供两个指标。气泡大小表示${spec.sizeName}（${spec.sizeUnit}）。`,
      `${points.filter(item => item.y > point.y).length} 个图示类别的${second.name}高于${point.label}。`);
  }

  if (spec.kind === "heatmap") {
    const focusRow = spec.series.find(row => row.name === spec.focus);
    const focusValue = spec.focusCell && spec.series[spec.focusCell[1]]?.values[spec.focusCell[0]];
    const rows = spec.series.map(row => ({ row, values: entries(spec.labels, row.values) })).filter(row => row.values.length);
    const all = rows.flatMap(row => row.values.map(entry => ({ ...entry, label: row.row.name + " · " + entry.label })));
    const { high, low } = extremes(all);
    const focused = focusRow && rows.find(row => row.row === focusRow);
    return write(focusValue != null && spec.focusCell
      ? `${spec.series[spec.focusCell[1]].name} · ${spec.labels[spec.focusCell[0]]}为 ${fmt(focusValue)}。`
      : `图示最大值出现在${high.label}，为 ${fmt(high.value)}。`,
    focused ? `${focused.row.name}有 ${focused.values.length} 个有值格，峰值在${extremes(focused.values).high.label}。`
      : `图中共有 ${all.length} 个有值格，跨 ${rows.length} 行。`,
    `图示最小值出现在${low.label}，为 ${fmt(low.value)}。空白格不参与范围计算。`,
    [{ label: "图示范围", text: fmt(low.value) + " 至 " + fmt(high.value) }]);
  }

  if (spec.kind === "boxplot" || spec.kind === "range-band") {
    const [selected, median, lower, upper, sample] = spec.kind === "range-band" ? spec.series
      : [spec.series[5], spec.series[2], spec.series[1], spec.series[3], spec.series[6]];
    const points = entries(spec.labels, median.values).filter(item =>
      lower.values[item.index] != null && upper.values[item.index] != null);
    if (!points.length) return write("当前缺少完整的分布统计。", "查看数值可区分可用与缺测的分位值。", "缺少同组分位值时无法判断所选值的位置。");
    const { high } = extremes(points);
    const point = points.find(item => item.label === spec.focus) ?? high;
    const i = point.index;
    const lo = lower.values[i]!, hi = upper.values[i]!, observation = selected.values[i];
    const position = observation == null ? "该期没有所选对象的数值。"
      : `${selected.name}为 ${fmt(observation)}，${observation < lo ? "低于" : observation > hi ? "高于" : "位于"}该期四分位区间${observation >= lo && observation <= hi ? "内" : ""}。`;
    return write(`${point.label}的中位数为 ${fmt(point.value)}，四分位区间为 ${fmt(lo)} 至 ${fmt(hi)}。`,
      `有 ${points.length} 组可比较的中位数，最高的是${high.label}（${fmt(high.value)}）。`,
      position, sample.values[i] != null ? [{ label: "样本数", text: `${point.label}有 ${sample.values[i]} 个有效样本。` }] : []);
  }

  if (spec.kind === "line" || spec.kind === "area" || spec.kind === "stacked-area" || spec.kind === "calendar") {
    const series = spec.series.map(item => ({ item, values: entries(spec.labels, item.values) })).filter(item => item.values.length);
    const { item, values } = series[0];
    const { high, low } = extremes(values);
    const unit = item.unit ?? spec.unit;
    const focus = values.find(point => point.label === spec.focus);
    const point = focus ?? values.at(-1)!;
    const start = values[0];
    const baseline = values.slice(0, -1);
    const unusual = !spec.forecast && point === values.at(-1) && point.index === spec.labels.length - 1 && values.length === spec.labels.length
      ? unexpectedValue(point.value, baseline.map(entry => entry.value)) : undefined;
    const counterpart = series[1];
    const paired = counterpart?.values.find(other => other.index === point.index);
    const prefix = spec.focus && !focus ? `所选期 ${spec.focus} 暂无数值。最后一个有值时段为 ` : "";
    return write(prefix ? `${prefix}${point.label}，${item.name}为 ${reading(point.value, unit)}。`
      : `${item.name}在 ${point.label} 的${forecast}值为 ${reading(point.value, unit)}。`,
      values.length > 1 ? `有 ${values.length} 个有效时段。最高在${high.label}（${reading(high.value, unit)}），最低在${low.label}（${reading(low.value, unit)}）。`
        : "序列只有一个有效时段，尚不能判断变化。",
      paired && (counterpart.item.unit ?? spec.unit) === unit ? comparisons({ ...point, label: item.name }, { ...paired, label: counterpart.item.name }, unit)
        : start !== point ? `与${start.label}的有效值相比，${point.label}${difference(point.value - start.value, unit === "%" ? "个百分点" : unit)}。`
          : `可用记录覆盖 ${values[0].label} 至 ${values.at(-1)!.label}。`,
      unusual ? [{ label: "异常值筛查", text: `${point.label}的值${unusual.direction}此前样本的四分位距筛查边界。` }] : []);
  }

  const values = firstValues.length ? firstValues : pair ?? [];
  if (!values.length) return write(missing, "当前没有可比较的分组数值。", "检查来源和筛选范围后可重新比较。");
  const { high, low } = extremes(values);
  const choice = values.find(item => item.label === spec.focus);
  const points = values.toSorted((a, b) => b.value - a.value);
  const leading = points[1];
  const focusSecond = pair?.find(point => point.index === (choice ?? high).index);
  const measure = firstValues.length ? first.name : second.name;
  const summary = choice ? `${choice.label}的${measure}为 ${fmt(choice.value)}。`
    : `${high.label}的${measure}为 ${fmt(high.value)}，是图中最高值。`;
  return write(summary, `图中有 ${values.length} 个有值分组，范围为 ${fmt(low.value)} 至 ${fmt(high.value)}。`,
    focusSecond ? comparisons({ ...(choice ?? high), label: first.name }, { ...focusSecond, label: second.name }, spec.unit)
      : leading ? comparisons(high, leading, spec.unit) : "仅有一个分组发布数值，可在后续有值时比较。",
    choice && high !== choice ? [{ label: "图示最高值", text: high.label + " · " + fmt(high.value) }] : []);
}
