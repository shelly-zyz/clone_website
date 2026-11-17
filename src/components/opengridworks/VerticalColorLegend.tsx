"use client";

import { useId } from "react";
import styles from "./VerticalColorLegend.module.css";

export function VerticalColorLegend({ label, unit, stops, ticks, note, className }: {
  label: string;
  unit?: string;
  stops: readonly (readonly [offset: number, color: string])[];
  ticks: readonly string[];
  note?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className ? styles.legend + " " + className : styles.legend} aria-label={label}>
      <strong>{label}</strong>
      {unit && <span>{unit}</span>}
      <div className={styles.body}>
        <svg className={styles.ramp} width="10" height="76" aria-hidden="true">
          <defs><linearGradient id={id} x1="0" x2="0" y1="1" y2="0">
            {stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
          </linearGradient></defs>
          <rect width="100%" height="100%" rx="2" fill={"url(#" + id + ")"} />
        </svg>
        <div className={styles.ticks}>{ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div>
      </div>
      {note && <span>{note}</span>}
    </div>
  );
}
