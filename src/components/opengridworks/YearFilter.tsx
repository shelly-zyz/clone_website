"use client";

import { Minus, Plus } from "lucide-react";
import { useId, useState } from "react";
import styles from "./YearFilter.module.css";

export function YearFilter({ years, year, onChange, label = "年份" }: {
  years: readonly number[];
  year?: number;
  onChange: (year: number) => void;
  label?: string;
}) {
  const availabilityId = useId();
  const index = year === undefined ? -1 : years.indexOf(year);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const first = years[0];
  const last = years.at(-1);
  const hasGaps = first !== undefined && last !== undefined && years.length !== last - first + 1;
  const range = first === last ? String(first) : hasGaps ? years.join("、") : `${first}–${last}`;

  function select(next: number) {
    setDraft(null);
    setInvalid(false);
    if (next !== year) onChange(next);
  }

  function commit() {
    if (draft === null) return;
    const value = Number(draft);
    if (/^\d{4}$/.test(draft) && years.includes(value)) select(value);
    else {
      setDraft(null);
      setInvalid(true);
    }
  }

  return (
    <div role="group" aria-label={label + "筛选"} className={styles.filter}>
      <div className={styles.controls}>
        <label className={styles.track}>
          <span>{label}</span>
          <input type="range" aria-label={label + "滑杆"} aria-describedby={availabilityId}
            aria-valuetext={index >= 0 ? `${year} 年` : "暂无已选年份"}
            min={0} max={Math.max(0, years.length - 1)} value={Math.max(0, index)} disabled={years.length < 2}
            onChange={event => select(years[Number(event.currentTarget.value)])} />
        </label>
        <div className={styles.stepper}>
          <button type="button" aria-label={label + "减一年"} disabled={index <= 0}
            onClick={() => select(years[index - 1])}><Minus size={14} aria-hidden="true" /></button>
          <input type="text" inputMode="numeric" maxLength={4} aria-label={label + "输入"} aria-describedby={availabilityId}
            aria-invalid={invalid} disabled={!years.length} value={draft ?? (index >= 0 ? String(year) : "")} placeholder="—"
            onChange={event => { setDraft(event.currentTarget.value); setInvalid(false); }}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); commit(); }
              if (event.key === "Escape") { setDraft(null); setInvalid(false); }
            }} />
          <button type="button" aria-label={label + "加一年"} disabled={!years.length || index >= years.length - 1}
            onClick={() => select(years[index + 1])}><Plus size={14} aria-hidden="true" /></button>
        </div>
      </div>
      <p id={availabilityId} className={styles.available}>
        {years.length ? `可选 ${range} 年` : "暂无可选年份"}
      </p>
      {invalid && <p role="status" className={styles.invalid}>请选择有数据的年份。</p>}
    </div>
  );
}
