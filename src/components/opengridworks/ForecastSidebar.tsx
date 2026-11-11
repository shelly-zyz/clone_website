"use client";

import { Activity, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import type { ForecastPoint } from "@/lib/globe-forecast";
import type { WorkspaceTopic } from "@/lib/globe-topics";
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

export function ForecastSidebar({ topic, children }: { topic: WorkspaceTopic; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const title = headings[topic];
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className={`og-forecast-region ${styles.region}`} data-topic={topic} onKeyDown={(event) => {
      if (event.key === "Escape" && open) close();
    }}>
      <button ref={trigger} type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}>
        <Activity size={16} aria-hidden="true" /> {title}
      </button>
      <aside id={panelId} className={styles.panel} data-open={open} aria-label={title}>
        <header className={styles.header}>
          <Activity size={18} aria-hidden="true" />
          <h2>{title}</h2>
          <button type="button" className={styles.close} aria-label="关闭预测侧栏" onClick={close}>
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.content}>{children}</div>
      </aside>
    </div>
  );
}

export function ForecastSeries({ points, observed = false, unit, grain, label }: {
  points: ForecastPoint[];
  observed?: boolean;
  unit: string;
  grain: Grain;
  label: string;
}) {
  const numeric = points.flatMap(({ value }) => value === null ? [] : [value]);
  if (!numeric.length) return null;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const time = ({ date }: ForecastPoint) => Date.parse(date);
  const start = time(points[0]);
  const span = time(points[points.length - 1]) - start || 1;
  const x = (point: ForecastPoint) => 5 + 210 * (time(point) - start) / span;
  const y = (value: number) => max === min ? 40 : 65 - 51 * (value - min) / (max - min);
  const path = points.map((point, index) => {
    if (point.value === null) return "";
    const command = index > 0 && points[index - 1].value !== null ? "L" : "M";
    return `${command}${x(point).toFixed(1)} ${y(point.value).toFixed(1)}`;
  }).join(" ");
  const rows = points.slice(-3);
  const formatter = unit === "kgC/h" ? compact : amount;
  return (
    <div className={styles.series}>
      {numeric.length > 1 && (
        <svg viewBox="0 0 220 76" role="img" aria-label={label} className={styles.chart}>
          <path className={styles.guide} d="M5 15 H215 M5 40 H215 M5 65 H215" />
          <path className={observed ? styles.observed : styles.predicted} d={path} />
          {points.map(point => point.value === null ? null : (
            <circle key={point.date} className={observed ? styles.observedPoint : styles.predictedPoint}
              cx={x(point)} cy={y(point.value)} r={2.25} />
          ))}
        </svg>
      )}
      <dl className={styles.values} aria-label={label}>
        {rows.map(({ date, value }) => (
          <div key={date}>
            <dt>{formatForecastDate(date, grain)}</dt>
            <dd>{value === null ? "暂无" : `${formatter.format(value)}${unit === "%" ? "%" : ` ${unit}`}`}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
