import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ScenarioScene.module.css";

type ScenarioOption = { id: string; label: string; icon?: LucideIcon };
type ScenarioPeriod = { id: string; label: string };
type ScenarioRow = { id: string; label: string; value: number | null };

export function ScenarioScene({
  title, period, accent = "lime", options, selectedOption, onOptionChange, controls, globe, summary, footer,
}: {
  title: string;
  period?: string | number;
  accent?: "lime" | "cyan" | "amber";
  options: readonly ScenarioOption[];
  selectedOption: string;
  onOptionChange: (id: string) => void;
  controls?: ReactNode;
  globe?: ReactNode;
  summary: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={styles.scene} data-accent={accent} aria-label={title}>
      <header className={styles.header}>
        <h1>{title}</h1>
        {controls}
      </header>
      <nav className={styles.options} aria-label="切换视图">
        {options.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={id === selectedOption} onClick={() => onOptionChange(id)}>
            {Icon && <span className={styles.optionIcon}><Icon size={19} aria-hidden="true" /></span>}
            <span className={styles.optionLabel}>{label}</span>
          </button>
        ))}
      </nav>
      <div className={styles.globe} data-interactive={globe != null}>{globe}</div>
      <aside className={styles.summary}>{summary}</aside>
      {period !== undefined && <div className={styles.period} aria-hidden="true" key={period}>{period}</div>}
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
}

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
  title, subtitle, label, value, rows, selected, onSelect, formatValue = String, children,
}: {
  title: string;
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
        <h2>{title}</h2>
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
