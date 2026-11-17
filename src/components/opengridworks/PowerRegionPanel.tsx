"use client";

import { ArrowUpRight } from "lucide-react";
import { chinaProvinces } from "@/lib/china-provinces";
import {
  type chinaPowerAnnualFrame, powerAmount, powerDemoNotice, provincePowerMax, type ProvincePowerFrame,
} from "@/lib/china-power-statistics";
import monthly from "@/lib/topic-analysis/nbs-monthly.json";
import { generationSeries } from "@/lib/topic-analysis/history";
import type { useReportedGeneration } from "@/hooks/use-reported-generation";
import type { WorkspaceContext } from "@/lib/workspace-context";
import { WorkspaceFilterSelect } from "./WorkspaceSidebar";
import styles from "./PowerRegionPanel.module.css";
import switcherStyles from "./SceneSwitcher.module.css";

type PowerView = NonNullable<WorkspaceContext["powerView"]>;
type MonthlyData = ReturnType<typeof useReportedGeneration>;
const viewTabs = [
  { id: "facilities", label: "设备" },
  { id: "generation", label: "发电量" },
  { id: "capacity", label: "装机" },
] as const;

const filterOptions = [
  { value: "", label: "中国全国" },
  ...chinaProvinces.map(item => ({ value: item.code, label: item.name })),
];

export function PowerViews({ view, onView }: { view: PowerView; onView: (view: PowerView) => void }) {
  return (
    <nav className={`${switcherStyles.bar} ${switcherStyles.scene}`} aria-label="电力地图视图">
      {viewTabs.map(({ id, label }) => (
        <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

export function PowerMapHeading({ frame }: { frame: ProvincePowerFrame }) {
  return (
    <div className={styles.mapHeading}>
      <strong>{frame.period} · {frame.label}{frame.demo ? " · 非真实统计" : ""}</strong>
      <span>{frame.unit}</span>
    </div>
  );
}

export function PowerMobileSelection({ frame, region }: { frame: ProvincePowerFrame; region: string }) {
  const province = chinaProvinces.find(item => item.code === region);
  const value = frame.regions.find(item => item.code === region)?.value;
  if (!province) return null;
  return (
    <div className={styles.mobileSelection} role="status">
      <strong>{province.name}</strong>
      <span>{frame.period} · {value == null ? "暂无数据" : `${powerAmount.format(value)} ${frame.unit}`}</span>
    </div>
  );
}

export function PowerPeriodSwitcher({ monthly, onChange }: { monthly: boolean; onChange: (monthly: boolean) => void }) {
  return (
    <div className={styles.period} role="group" aria-label="发电量统计周期">
      <button type="button" aria-pressed={!monthly} onClick={() => onChange(false)}>年度合计</button>
      <button type="button" aria-pressed={monthly} onClick={() => onChange(true)}>月度发布</button>
    </div>
  );
}

export function PowerAnnualPanel({ frame, region, onYearChange, onRegionChange, onRankSelect }: {
  frame: ReturnType<typeof chinaPowerAnnualFrame>;
  region: string;
  onYearChange: (year: number) => void;
  onRegionChange: (region: string) => void;
  onRankSelect: (region: string) => void;
}) {
  const selected = frame.regions.find(item => item.code === region);
  const leading = frame.regions.toSorted((a, b) => b.value - a.value).slice(0, 5);
  const maximum = provincePowerMax(frame);

  return (
    <section className={styles.panel} aria-label={frame.label}>
      <div className={styles.filters}>
        <WorkspaceFilterSelect label="统计年份" value={String(frame.year)}
          options={frame.years.toReversed().map(year => ({ value: String(year), label: `${year} 年` }))}
          onChange={value => onYearChange(Number(value))} />
        <WorkspaceFilterSelect label="地区" value={region} options={filterOptions} onChange={onRegionChange} />
      </div>
      <header>
        <span>{frame.period} · {frame.label}</span>
        <h2>{selected?.name ?? "中国全国"}</h2>
      </header>
      <div className={styles.stat} aria-live="polite">
        <strong>{powerAmount.format(selected?.value ?? frame.total)}</strong><span>{frame.unit}</span>
      </div>
      <PowerMapLegend frame={frame} />
      <div className={styles.source}>
        <a href={frame.source} target="_blank" rel="noreferrer">中国电力统计年鉴 2024 · {frame.table} <ArrowUpRight size={12} aria-hidden="true" /></a>
        <span>统计覆盖 {frame.regions.length} 个省级地区</span>
      </div>
      <section className={styles.mix} aria-label="省级前五">
        <h3>省级前五</h3>
        {leading.map(item => (
          <button key={item.code} type="button" aria-pressed={region === item.code} onClick={() => onRankSelect(item.code)}>
            <span>{item.name}</span><strong>{powerAmount.format(item.value)}</strong>
            <progress aria-label={item.name} value={item.value} max={maximum} />
          </button>
        ))}
      </section>
    </section>
  );
}

function PowerMapLegend({ frame }: { frame: ProvincePowerFrame }) {
  const maximum = frame.scaleMax;
  return (
    <div className={styles.legend} aria-label="省级地图图例">
      {maximum > 0 ? (
        <>
          <span>柱高与颜色 · 统一量程</span>
          <div className={styles.scale} aria-hidden="true" />
          <div><span>0</span><span>{powerAmount.format(maximum / 2)}</span><span>{powerAmount.format(maximum)} {frame.unit}</span></div>
        </>
      ) : null}
      <span className={styles.missing}>暂无数据</span>
    </div>
  );
}

export function PowerMonthlyPanel({ frame, data, region, category, onRegionChange, onMonthChange, onCategory, onDemoChange }: {
  frame: ProvincePowerFrame;
  data: MonthlyData;
  region: string;
  category: string;
  onRegionChange: (region: string) => void;
  onMonthChange: (month: string) => void;
  onCategory: (id: string) => void;
  onDemoChange: (enabled: boolean) => void;
}) {
  const demo = frame.demo === true;
  const displayMonth = demo ? frame.period : data.month;
  const monthOptions = [...new Set([...data.months, displayMonth].filter(Boolean))].sort().toReversed()
    .map(value => ({ value, label: value }));
  const pending = data.publishedPending || data.regionalPending;
  const monthlyReport = demo || data.versionUnavailable ? undefined : monthly.find(item => item.date === data.month);
  const local = frame.regions.find(item => item.code === region);
  const selected = chinaProvinces.find(item => item.code === region);
  const product = generationSeries.find(item => item.id === category) ?? generationSeries[0];
  const publishedValue = product.id === "electricity" ? data.total : data.composition.find(item => item.id === product.id)?.value;
  const breakdown = demo ? [] : data.published ? data.composition : monthlyReport ? generationSeries.slice(1).map(item => ({
    ...item, value: monthlyReport.values[item.id] ?? null,
  })) : [];
  const maximum = Math.max(...breakdown.map(item => item.value ?? 0), 1);
  const total = selected ? local?.value : demo ? frame.total : data.published ? publishedValue : monthlyReport?.values[product.id];
  const source = demo ? undefined : data.published ? "https://data.stats.gov.cn/easyquery.htm?cn=" + (selected ? "E0101" : "A01") : monthlyReport?.source;
  const yoy = selected || demo ? null : data.published
    ? product.id === "electricity" ? data.yoy : null : monthlyReport?.yoy[product.id];
  const hasRegionalData = frame.regions.some(item => item.value != null);
  const latestRegionalMonth = !demo && !hasRegionalData && data.latestRegionalMonth !== data.month ? data.latestRegionalMonth : null;
  const monthlyStatus = demo ? powerDemoNotice : data.versionUnavailable ? "该发布版本暂不可读取。"
    : pending ? "正在读取月度发布数据…"
    : data.regionalUnavailable ? "暂时无法读取分省月度数据。"
    : !hasRegionalData ? "本月暂无分省发布数据。"
    : selected && total == null ? "该省本月暂无同口径数据。"
    : null;

  return (
    <section className={styles.panel} aria-label="月度发电量">
      <div className={styles.filters}>
        <WorkspaceFilterSelect label="统计月份" value={displayMonth}
          options={displayMonth ? monthOptions : [
            { value: "", label: pending ? "读取中…" : "暂无月份", disabled: true }, ...monthOptions,
          ]} onChange={onMonthChange} />
        <WorkspaceFilterSelect label="地区" value={region} options={filterOptions} onChange={onRegionChange} />
      </div>
      <label className={styles.demoMode}>
        <input type="checkbox" checked={demo} onChange={event => onDemoChange(event.target.checked)} />
        演示模式（人工合成，非真实统计）
      </label>
      <header>
        <span>{displayMonth || "月度发布"} · {product.name}{demo ? " · 演示" : ""}</span>
        <h2>{selected?.name ?? "中国全国"}</h2>
      </header>
      <div className={styles.stat} aria-live="polite">
        <strong>{total == null ? "—" : powerAmount.format(total)}</strong><span>{frame.unit}</span>
        {typeof yoy === "number" ? <span className={styles.yoy}>同比 {yoy > 0 ? "+" : ""}{powerAmount.format(yoy)}%</span> : null}
      </div>
      {monthlyStatus ? <p className={styles.note}>{monthlyStatus}</p> : null}
      {latestRegionalMonth ? (
        <button type="button" className="og-workspace-action" onClick={() => onMonthChange(latestRegionalMonth)}>
          查看有分省数据的 {latestRegionalMonth}
        </button>
      ) : null}
      {hasRegionalData ? <PowerMapLegend frame={frame} /> : null}
      <section className={styles.mix} aria-label="全国电源结构">
        <h3>{demo ? "演示电源类型" : "全国已公布分项"}</h3>
        {demo ? generationSeries.map(item => (
          <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>{item.name}</button>
        )) : null}
        {!demo && (breakdown.length ? breakdown.map(item => (
          <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>
            <span>{item.name}</span><strong>{item.value == null ? "—" : powerAmount.format(item.value)}</strong>
            <progress aria-label={item.name} value={item.value ?? 0} max={maximum} />
          </button>
        )) : <p className={styles.note}>本期未公布分电源统计。</p>)}
      </section>
      <footer>
        {source ? <a href={source} target="_blank" rel="noreferrer">国家统计局 · 规模以上工业 <ArrowUpRight size={12} aria-hidden="true" /></a> : null}
        {!demo && data.published ? <span>发布版本 {data.published.version.slice(0, 12)}</span> : null}
        {demo ? <span>本地固定样本，仅用于交互演示；未写入数据库。</span> : null}
      </footer>
    </section>
  );
}
