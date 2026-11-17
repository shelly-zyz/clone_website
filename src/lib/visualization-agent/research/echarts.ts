import type { EChartsOption, SeriesOption } from "echarts";
import type { FigureDesign, FigureModel, FigurePanel } from "./contracts";
import { quantile } from "./planner";

const typeface = (design: FigureDesign) => design.font + ', "PingFang SC", "Microsoft YaHei", sans-serif';
const labels = (design: FigureDesign) => ({ color: design.muted, fontSize: design.font_size, hideOverlap: true });
const stroke = (design: FigureDesign) => ({ color: design.grid });
const escape = (value: string) => value.replace(/[{}]/g, "");

function summary(numbers: (number | null)[]) {
  const values = numbers.filter((value): value is number => value !== null).toSorted((a, b) => a - b);
  const quartiles = [0.25, 0.5, 0.75].map(p => quantile(values, p));
  const iqr = quartiles[2] - quartiles[0];
  const inliers = values.filter(value => value >= quartiles[0] - 1.5 * iqr && value <= quartiles[2] + 1.5 * iqr);
  const low = inliers[0], high = inliers.at(-1)!;
  return { box: [low, ...quartiles, high], outliers: values.filter(value => value < low || value > high) };
}

const temporal = (axis: FigurePanel["axis"], categories: string[], data: (number | null)[]) =>
  axis === "time" ? data.map((value, index) => [categories[index], value]) : data;

export function buildECharts(model: FigureModel, design: FigureDesign, narrow = false): EChartsOption {
  const columns = narrow ? 1 : model.columns;
  const focus = model.focus && columns > 1;
  const rows = focus ? Math.ceil((model.panels.length - 1) / columns) + 1 : Math.ceil(model.panels.length / columns);
  const rowPct = 94 / rows;
  const grids: NonNullable<EChartsOption["grid"]>[] = [];
  const xAxes: NonNullable<EChartsOption["xAxis"]>[] = [];
  const yAxes: NonNullable<EChartsOption["yAxis"]>[] = [];
  const titles: NonNullable<EChartsOption["title"]>[] = [];
  const legends: NonNullable<EChartsOption["legend"]>[] = [];
  const visualMaps: NonNullable<EChartsOption["visualMap"]>[] = [];
  const calendars: NonNullable<EChartsOption["calendar"]>[] = [];
  const polar: NonNullable<EChartsOption["polar"]>[] = [];
  const angleAxis: NonNullable<EChartsOption["angleAxis"]>[] = [];
  const radiusAxis: NonNullable<EChartsOption["radiusAxis"]>[] = [];
  const series: SeriesOption[] = [];

  for (const [index, panel] of model.panels.entries()) {
    const main = focus && index === 0;
    const seq = focus ? index - 1 : index;
    const row = main ? 0 : Math.floor(seq / columns) + Number(focus);
    const col = main ? 0 : seq % columns;
    const width = main ? 100 : 100 / columns;
    const left = col * width;
    const right = 100 - left - width;
    const top = 4 + row * rowPct;
    const unit = panel.series[0]?.unit ?? "";
    const x = panel.x.map(escape);
    const multi = panel.series.length > 1;
    const legend = multi && design.legend !== "none";
    const rightLegend = legend && design.legend === "right";
    const trimTitle = (text: string) => text.length > (columns > 1 && !main ? 36 : 62) ? text.slice(0, columns > 1 && !main ? 35 : 61) + "…" : text;
    const heading = trimTitle(model.panels.length === 1 ? model.title : panel.title);
    titles.push({ text: heading, subtext: panel.kind === "grid" ? "经度 / 纬度（°） · " + unit : undefined,
      top: top + "%", left: left + 2 + "%", itemGap: 4,
      textStyle: { color: design.foreground, fontSize: design.font_size + 3, fontWeight: 600 },
      subtextStyle: { color: design.muted, fontSize: design.font_size } });
    if (legend) legends.push({ data: panel.series.map(item => item.name), type: "scroll", orient: rightLegend ? "vertical" : "horizontal",
      top: design.legend === "top" || rightLegend ? top + rowPct * 0.13 + "%" : top + rowPct * 0.87 + "%",
      left: rightLegend ? undefined : left + 3 + "%", right: right + 3 + "%", itemWidth: 11, itemHeight: 7, textStyle: labels(design) });

    if (panel.kind === "flow") {
      const links = panel.links ?? [];
      const nodes = [...new Set(links.flatMap(link => [link.source, link.target]))];
      series.push({ name: unit, type: "sankey", data: nodes.map(name => ({ name })), links, nodeWidth: 12, nodeGap: 11,
        top: top + rowPct * 0.19 + "%", height: rowPct * 0.66 + "%", left: left + 4 + "%", right: right + 14 + "%",
        draggable: false, label: { color: design.foreground, fontSize: design.font_size },
        lineStyle: { color: "gradient", opacity: 0.48, curveness: 0.55 } });
      continue;
    }
    if (panel.kind === "calendar") {
      const calendarIndex = calendars.length;
      calendars.push({
        range: x[0].slice(0, 4), top: top + rowPct * 0.24 + "%", left: left + 7 + "%", right: right + 7 + "%",
        cellSize: ["auto", 15], itemStyle: { color: design.background, borderColor: design.grid, borderWidth: 1 },
        yearLabel: { show: false }, dayLabel: { color: design.muted, margin: 4, nameMap: "ZH" }, monthLabel: { color: design.muted },
      });
      const cells = panel.series[0].data.flatMap((value, i) => value === null ? [] : [[x[i].slice(0, 10), value]]);
      const values = cells.map(entry => Number(entry[1]));
      const min = Math.min(...values);
      visualMaps.push({ show: true, type: "continuous", min, max: Math.max(min + 1e-9, ...values), seriesIndex: series.length,
        right: right + 6 + "%", top: top + rowPct * 0.69 + "%", orient: "horizontal", itemWidth: 10, itemHeight: 98,
        textStyle: labels(design), inRange: { color: design.continuous } });
      series.push({ type: "heatmap", coordinateSystem: "calendar", calendarIndex, data: cells, name: unit });
      continue;
    }
    if (panel.kind === "rose") {
      const polarIndex = polar.length;
      polar.push({ center: [left + width / 2 + "%", top + rowPct * 0.55 + "%"], radius: rowPct * 0.46 + "%" });
      angleAxis.push({ type: "category", data: x, polarIndex, axisLabel: labels(design) });
      radiusAxis.push({ type: "value", min: 0, polarIndex, axisLabel: labels(design), splitLine: { lineStyle: stroke(design) } });
      series.push({ type: "bar", coordinateSystem: "polar", polarIndex, name: unit, data: panel.series[0].data, itemStyle: { color: design.colors[0] } });
      continue;
    }

    const axisIndex = grids.length;
    const horizontal = panel.kind === "rank" || panel.kind === "dumbbell";
    const cells = panel.kind === "grid" || panel.kind === "correlation";
    const categoryAxis = { type: "category" as const, axisLabel: { ...labels(design), width: 104, overflow: "truncate" as const },
      axisLine: { lineStyle: stroke(design) }, axisTick: { show: false } };
    const numberAxis = { type: "value" as const, axisLabel: labels(design), nameTextStyle: labels(design),
      splitLine: { lineStyle: stroke(design) }, axisLine: { lineStyle: stroke(design) } };
    grids.push({ left: left + (horizontal ? 14 : 7) + "%", right: right + (rightLegend ? 20 : cells ? 11 : 5) + "%",
      top: top + rowPct * (cells || legend && design.legend === "top" ? 0.24 : 0.17) + "%",
      height: rowPct * (legend && design.legend === "bottom" ? 0.56 : 0.65) + "%" });
    xAxes.push(horizontal ? { ...numberAxis, gridIndex: axisIndex, name: unit, nameLocation: "center", nameGap: 29 }
      : panel.axis === "time" ? { type: "time", gridIndex: axisIndex, axisLabel: labels(design), axisLine: { lineStyle: stroke(design) }, splitNumber: narrow ? 3 : 6 }
        : panel.axis === "number" ? { ...numberAxis, gridIndex: axisIndex, name: panel.x_unit, nameLocation: "center", nameGap: 32 }
          : { ...categoryAxis, gridIndex: axisIndex, data: x,
            name: panel.kind === "grid" ? "经度" : undefined, nameLocation: "center", nameGap: 24 });
    yAxes.push(horizontal ? { ...categoryAxis, gridIndex: axisIndex, data: x, inverse: true }
      : cells ? { ...categoryAxis, gridIndex: axisIndex, data: panel.row_labels, inverse: panel.kind === "grid" }
        : { ...numberAxis, gridIndex: axisIndex, name: unit, scale: panel.kind === "trend" || panel.kind === "forecast", nameGap: 10 });
    const binding = { xAxisIndex: axisIndex, yAxisIndex: axisIndex };

    if (cells) {
      const values = (panel.cells ?? []).map(cell => cell[2]);
      const low = panel.kind === "correlation" ? -1 : Math.min(...values);
      const high = panel.kind === "correlation" ? 1 : Math.max(low + 1e-9, ...values);
      visualMaps.push({ type: "continuous", min: low, max: high, seriesIndex: series.length, dimension: 2,
        orient: "vertical", calculable: false, itemWidth: 8, itemHeight: 72, right: right + 1 + "%", top: top + rowPct * 0.34 + "%",
        textStyle: { color: design.muted, fontSize: 9 }, inRange: { color: panel.kind === "correlation" ? design.diverging : design.continuous } });
      series.push({ ...binding, type: "heatmap", data: panel.cells, name: unit,
        ...(panel.kind === "correlation" ? { label: { show: true, formatter: "{@[2]}" } } : {}),
        emphasis: { itemStyle: { borderColor: design.foreground, borderWidth: 1 } } });
    } else if (panel.kind === "scatter") {
      series.push({ ...binding, type: "scatter", name: panel.series[0].name, data: panel.points, symbolSize: 8,
        itemStyle: { color: design.colors[index % design.colors.length], borderColor: design.background, borderWidth: 1, opacity: 0.8 } });
    } else if (panel.kind === "box") {
      const summaries = panel.series.map(item => summary(item.data));
      series.push({ ...binding, type: "boxplot", name: unit, boxWidth: [10, 50], data: summaries.map((item, i) => {
        const ink = design.colors[(i + index) % design.colors.length];
        return { value: item.box, itemStyle: { color: ink + "22", borderColor: ink, borderWidth: 1.6 } };
      }) },
        { ...binding, type: "scatter", name: "超出四分位围栏", data: summaries.flatMap((item, i) => item.outliers.map(value => [i, value])),
          symbolSize: 5, itemStyle: { color: design.colors[1] } });
    } else if (panel.kind === "dumbbell") {
      for (const [i, name] of x.entries()) series.push({ ...binding, type: "line", name: "差值",
        data: panel.series.map(item => [item.data[i], name]), symbol: "none", silent: true, tooltip: { show: false }, lineStyle: stroke(design) });
      panel.series.forEach((item, i) => series.push({ ...binding, type: "scatter", name: item.name, symbol: i ? "diamond" : "circle",
        data: item.data.map((value, j) => [value, x[j]]), itemStyle: { color: design.colors[i] } }));
    } else if (panel.kind === "waterfall") {
      let start = 0;
      const offsets = [], over = [], under = [], below = [];
      for (const value of panel.series[0].data) {
        if (value === null) { offsets.push(null); over.push(null); under.push(null); below.push(null); continue; }
        const end = start + value, low = Math.min(start, end), high = Math.max(start, end);
        offsets.push(Math.max(0, low));
        over.push(Math.max(0, high) - Math.max(0, low));
        under.push(Math.min(0, high));
        below.push(Math.min(0, low) - Math.min(0, high));
        start = end;
      }
      for (const [i, values] of [offsets, under, over, below].entries()) series.push({
        ...binding, type: "bar", name: i < 2 ? "位置" : unit, data: values, stack: "rise",
        itemStyle: { color: i < 2 ? "transparent" : design.colors[i % 2] }, tooltip: { show: false }, silent: true,
      });
    } else {
      for (const [i, item] of panel.series.entries()) {
        const color = design.colors[(i + index) % design.colors.length];
        const data = temporal(panel.axis, x, item.data);
        const pattern = item.forecast ? "dashed" : design.theme === "academic-monochrome" && i % 3 ? (i % 3 === 1 ? "dashed" : "dotted") : "solid";
        const symbol = ["circle", "diamond", "triangle"][i % 3];
        if (item.interval && panel.axis === "time") {
          const band = "interval-" + index + "-" + i;
          for (const [offset, area] of [false, true].entries()) {
            series.push({ ...binding, type: "line", name: item.name + (area ? "区间" : "区间起点"), stack: band,
              stackStrategy: "all", showSymbol: false, connectNulls: false, lineStyle: { opacity: 0 },
              areaStyle: area ? { color, opacity: 0.16 } : undefined, silent: true, tooltip: { show: false },
              data: item.interval.map((interval, j) => [x[j], interval ? offset ? interval[1] - interval[0] : interval[0] : null]) });
          }
        }
        if (panel.kind === "rank") {
          series.push({ ...binding, type: "bar", name: item.name, data, barWidth: 2, silent: true, itemStyle: { color: color + "42" } },
            { ...binding, type: "scatter", name: item.name, symbolSize: x.length > 20 ? 7 : 12,
              data: item.data.flatMap((value, n) => value === null ? [] : [[value, x[n]]]),
              itemStyle: { color, borderColor: design.background, borderWidth: 1.25 } });
        } else if (panel.kind === "columns") {
          series.push({ ...binding, type: "bar", name: item.name, data, barMaxWidth: 28, itemStyle: {
            color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color }, { offset: 1, color: color + "85" }] },
            borderRadius: [3, 3, 0, 0],
          } });
        } else {
          const stack = panel.kind === "stack";
          series.push({ ...binding, type: "line", name: item.name, data, symbol, showSymbol: !stack && item.data.length <= 18,
            symbolSize: 6, connectNulls: false, lineStyle: { color, type: pattern, width: 2.1 },
            itemStyle: { color }, stack: stack ? "composition" : undefined, areaStyle: stack ? { color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + "93" }, { offset: 1, color: color + "37" }],
            }, opacity: 1 } : undefined });
        }
      }
    }
  }

  // Each item above is one option object. ECharts' public component types also accept arrays.
  return {
    useUTC: true, animation: false, backgroundColor: design.background, color: design.colors,
    textStyle: { fontFamily: typeface(design), color: design.foreground, fontSize: design.font_size },
    title: titles.flat(), legend: legends.flat(), grid: grids.flat(), xAxis: xAxes.flat(), yAxis: yAxes.flat(), series,
    ...(visualMaps.length ? { visualMap: visualMaps.flat() } : {}), ...(calendars.length ? { calendar: calendars.flat() } : {}),
    ...(polar.length ? { polar: polar.flat(), angleAxis: angleAxis.flat(), radiusAxis: radiusAxis.flat() } : {}),
    tooltip: { trigger: "item", renderMode: "richText", confine: true, textStyle: { color: design.foreground }, backgroundColor: design.background },
  };
}
