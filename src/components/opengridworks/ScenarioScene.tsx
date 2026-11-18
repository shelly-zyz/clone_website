import type { ReactNode } from "react";
import styles from "./ScenarioScene.module.css";

type ScenarioPeriod = { id: string; label: string };
type ScenarioRow = { id: string; label: string; value: number | null };

export function ScenarioPeriods({ periods, selected, onSelect, label = "目标年份" }: {
  periods: readonly ScenarioPeriod[];
  selected: string;
  onSelect: (id: string) => void;
  label?: string;
}) {
  return (
    <div className={styles.periods} role="group" aria-label={label}>
      {periods.map(({ id, label: text }) => (
        <button key={id} type="button" aria-pressed={id === selected} onClick={() => onSelect(id)}>{text}</button>
      ))}
    </div>
  );
}

export function ScenarioRanking({
  title, showTitle = true, subtitle, label, value, rows, selected, onSelect, formatValue = String, children,
}: {
  title: string;
  showTitle?: boolean;
  subtitle?: string;
  label?: string;
  value?: string;
  rows: readonly ScenarioRow[];
  selected?: string;
  onSelect?: (id: string) => void;
  formatValue?: (value: number) => string;
  children?: ReactNode;
}) {
  const maximum = Math.max(1, ...rows.map(({ value: number }) => Math.abs(number ?? 0)));
  return (
    <section className={styles.ranking} aria-label={title}>
      <div className={styles.rankingIntro}>
        {subtitle && <p>{subtitle}</p>}
        {showTitle && <h2>{title}</h2>}
        {label !== undefined && <p>{label}</p>}
        {value !== undefined && <strong className={styles.total} key={value}>{value}</strong>}
      </div>
      {rows.length > 0 && (
        <ol className={styles.rankList}>
          {rows.map(({ id, label: name, value: amount }) => {
            const row = <>
              <span className={styles.rankLabel}>{name}</span>
              <span className={styles.rankValue}>{amount === null ? "暂无" : formatValue(amount)}</span>
              <progress className={styles.rankBar} max={maximum} value={Math.abs(amount ?? 0)}
                data-negative={(amount ?? 0) < 0} aria-hidden="true" />
            </>;
            return (
              <li key={id}>
                {onSelect ? (
                  <button type="button" aria-pressed={selected === id} onClick={() => onSelect(id)}>{row}</button>
                ) : <div>{row}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {children && <div className={styles.rankingDetails}>{children}</div>}
    </section>
  );
}
