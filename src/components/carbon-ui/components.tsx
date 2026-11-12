import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, Cloud, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./carbon-ui.module.css";

export type CarbonTone = "neutral" | "accent" | "energy" | "carbon" | "info" | "danger";

export function CarbonTheme({ theme = "dark", className, children }: {
  theme?: "dark" | "light";
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(styles.theme, className)} data-theme={theme}>{children}</div>;
}

export function CarbonPanel({ title, description, action, appearance = "surface", className, children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  appearance?: "surface" | "dashboard";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(styles.panel, className)} data-appearance={appearance}>
      <header className={styles.panelHeader}>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function CarbonBadge({ tone = "neutral", children }: {
  tone?: CarbonTone;
  children: ReactNode;
}) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

export function CarbonMetric({ label, value, unit, detail, icon, tone = "accent" }: {
  label: string;
  value: string | number | null;
  unit?: string;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: CarbonTone;
}) {
  return (
    <dl className={styles.metric} data-tone={tone}>
      <dt>
        {icon && <span className={styles.metricIcon} aria-hidden="true">{icon}</span>}
        {label}
      </dt>
      <dd className={styles.metricValue}>
        <strong>{value ?? "—"}</strong>
        {value !== null && unit && <span>{unit}</span>}
      </dd>
      {detail != null && <dd className={styles.metricDetail}>{detail}</dd>}
    </dl>
  );
}

export function CarbonButton({ appearance = "primary", className, ...props }:
  Omit<ComponentProps<typeof Button>, "variant"> & { appearance?: "primary" | "secondary" }) {
  return (
    <Button
      {...props}
      variant="ghost"
      className={cn(styles.button, className)}
      data-appearance={appearance}
    />
  );
}

export function CarbonSelect({ label, options, className, ...props }:
  Omit<ComponentProps<"select">, "children"> & {
    label: string;
    options: readonly { value: string; label: string }[];
  }) {
  return (
    <label className={cn(styles.select, className)}>
      <span>{label}</span>
      <select {...props}>
        {options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
}

export type CarbonColumn<Row> = {
  key: string;
  title: string;
  align?: "start" | "end";
  render: (row: Row) => ReactNode;
};

export function CarbonTable<Row>({ label, rows, columns, rowKey }: {
  label: string;
  rows: readonly Row[];
  columns: readonly CarbonColumn<Row>[];
  rowKey: (row: Row) => string | number;
}) {
  return (
    <div className={styles.tableScroll} role="region" aria-label={label} tabIndex={0}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align}>{column.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} data-align={column.align}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const stateIcons = { empty: Cloud, error: CircleAlert, loading: LoaderCircle };

export function CarbonState({ kind, title, description, action }: {
  kind: keyof typeof stateIcons;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon = stateIcons[kind];

  return (
    <div className={styles.state} data-state={kind}>
      <div role={kind === "error" ? "alert" : "status"}>
        <Icon aria-hidden="true" size={22} />
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CarbonBreakdown({ label, items }: {
  label: string;
  items: readonly { label: string; value: number; tone: CarbonTone }[];
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return <CarbonState kind="empty" title="暂无构成数据" />;

  const format = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

  return (
    <ul className={styles.breakdown} aria-label={label}>
      {items.map((item) => {
        const share = item.value / total;
        return (
          <li key={item.label} data-tone={item.tone}>
            <div><span>{item.label}</span><strong>{format.format(share)}</strong></div>
            <meter min={0} max={1} value={share} aria-label={item.label} />
          </li>
        );
      })}
    </ul>
  );
}

export function CarbonEvidence({ summary = "核算说明与来源", children }: {
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className={styles.evidence}>
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}
