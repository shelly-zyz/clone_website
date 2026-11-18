"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import type { ForecastPoint } from "@/lib/globe-forecast";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import { ForecastVisualization, type ForecastSample } from "./ForecastVisualization";
import styles from "./ForecastSidebar.module.css";

const headings = { power: "电力预测", weather: "气象预报", carbon: "碳排放预测", economy: "经济展望" };
const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });

type Grain = "hour" | "day" | "month" | "year";

export function formatForecastDate(date: string, grain: Grain) {
  if (grain === "year") return date.slice(0, 4) + " 年";
  if (grain === "month") return date.slice(0, 7);
  if (grain === "day") return date.slice(0, 10);
  return date.slice(0, 16).replace("T", " ") + " UTC";
}

export function ForecastHeading({ topic, title, imageSrc, children }: {
  topic: WorkspaceTopic; title?: string; imageSrc?: string; children?: ReactNode;
}) {
  return (
    <header className={styles.header} data-topic={topic}>
      <Image className={styles.thumbnail} src={imageSrc ?? `/images/opengridworks/forecasts/${topic}.webp`}
        alt="" width={74} height={74} unoptimized />
      <h2>{title ?? headings[topic]}</h2>
      {children}
    </header>
  );
}

export function ForecastSidebar({ topic, children }: { topic: WorkspaceTopic; children: ReactNode }) {
  return (
    <section className={styles.region} data-topic={topic} aria-label={headings[topic]}>
      <ForecastHeading topic={topic} />
      <div className={styles.content}>{children}</div>
    </section>
  );
}

type PlotPoint = ForecastPoint & { p10?: number; p90?: number };

export function ForecastSeries({ points, observed = false, unit, grain, label, chart, comparison }: {
  points: PlotPoint[];
  observed?: boolean;
  unit: string;
  grain: Grain;
  label: string;
  chart: WorkspaceTopic | "line";
  comparison?: { primaryLabel: string; label: string; points: ForecastPoint[] };
}) {
  if (!points.some(({ value }) => value !== null)) return null;
  const times = points.map(({ date }) => Date.parse(date));
  const span = times[times.length - 1] - times[0];
  const hasTimeline = span > 0 && times.every(Number.isFinite);
  const positions = times.map((time, index) => {
    if (hasTimeline) return (time - times[0]) / span;
    return points.length === 1 ? 0.5 : index / (points.length - 1);
  });
  const rows = points.slice(-3);
  const formatter = unit === "kgC/h" ? compact : amount;
  const formatValue = (value: number) => `${formatter.format(value)}${unit === "%" ? "%" : ` ${unit}`}`;
  const sample = ({ date, value, p10, p90 }: PlotPoint, index: number): ForecastSample => ({
    date, position: positions[index], value, p10, p90, dateLabel: formatForecastDate(date, grain),
    tickLabel: grain === "hour" ? date.slice(5, 16).replace("T", " ") : formatForecastDate(date, grain),
  });
  const benchmark = comparison && new Map(comparison.points.map(({ date, value }) => [date, value]));
  const benchmarkSamples = benchmark && points.map(({ date }, index) => sample({ date, value: benchmark.get(date) ?? null }, index));
  return (
    <div className={styles.series}>
      {chart === "line" ? (
        <ForecastLine points={points} positions={positions} label={label} />
      ) : (
        <ForecastVisualization topic={chart} observed={observed} label={label} unit={unit} formatValue={formatValue}
          samples={points.map(sample)} comparison={comparison && benchmarkSamples?.some(({ value }) => value !== null) ? {
            label: comparison.label, primaryLabel: comparison.primaryLabel, samples: benchmarkSamples,
          } : undefined} />
      )}
      <dl className={styles.values} aria-label={label}>
        {rows.map(({ date, value }) => (
          <div key={date}>
            <dt>{formatForecastDate(date, grain)}</dt>
            <dd>{value === null ? "暂无" : formatValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ForecastLine({ points, positions, label }: {
  points: ForecastPoint[];
  positions: number[];
  label: string;
}) {
  const numeric = points.flatMap(({ value }) => value === null ? [] : [value]);
  if (numeric.length < 2) return null;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const x = (index: number) => 5 + 210 * positions[index];
  const y = (value: number) => max === min ? 40 : 65 - 51 * (value - min) / (max - min);
  const path = points.map(({ value }, index) => {
    if (value === null) return "";
    const command = index > 0 && points[index - 1].value !== null ? "L" : "M";
    return `${command}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 220 76" role="img" aria-label={label} className={styles.chart}>
      <path className={styles.guide} d="M5 15 H215 M5 40 H215 M5 65 H215" />
      <path className={styles.observed} d={path} />
      {points.map(({ date, value }, index) => value === null ? null : (
        <circle key={date} className={styles.observedPoint} cx={x(index)} cy={y(value)} r={2.25} />
      ))}
    </svg>
  );
}
