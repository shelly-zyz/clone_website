"use client";

import { ArrowUpRight, Factory, Globe2, Layers3, MapIcon, Zap } from "lucide-react";
import { chinaProvinces } from "@/lib/china-provinces";
import {
  chinaPowerAnnualFrame, powerAmount, provincePowerMax, type ProvincePowerFrame,
} from "@/lib/china-power-statistics";
import monthly from "@/lib/topic-analysis/nbs-monthly.json";
import { generationSeries } from "@/lib/topic-analysis/history";
import type { useReportedGeneration } from "@/hooks/use-reported-generation";
import type { WorkspaceContext } from "@/lib/workspace-context";
import { WorkspaceFilterSelect } from "./WorkspaceSidebar";
import styles from "./PowerRegionPanel.module.css";

type PowerView = NonNullable<WorkspaceContext["powerView"]>;
type Projection = NonNullable<WorkspaceContext["projection"]>;
type MonthlyData = ReturnType<typeof useReportedGeneration>;
const viewTabs = [
  { id: "facilities", label: "设施", icon: Factory },
  { id: "generation", label: "发电量", icon: Zap },
  { id: "capacity", label: "装机", icon: Layers3 },
] as const;

const projectionTabs = [
  { id: "globe", label: "电力地球", icon: Globe2 },
  { id: "map", label: "二维电力地图", icon: MapIcon },
] as const;

const filterOptions = [
  { value: "", label: "中国全国" },
  ...chinaProvinces.map(item => ({ value: item.code, label: item.name })),
];

export function PowerViews({ view, onView }: { view: PowerView; onView: (view: PowerView) => void }) {
  return (
    <div className={styles.switcher} role="group" aria-label="电力地图视图">
      {viewTabs.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}>
          <Icon size={14} aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  );
}

export function PowerProjectionSwitcher({ projection, onChange }: {
  projection: Projection;
  onChange: (projection: Projection) => void;
}) {
  return (
    <div className={styles.projection} role="group" aria-label="电力地图投影">
      {projectionTabs.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={projection === id} onClick={() => onChange(id)}>
          <Icon size={16} aria-hidden="true" />{label}
        </button>
      ))}
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

export function PowerAnnualPanel({ frame, region, analysisHref, onYearChange, onRegionChange, onRankSelect }: {
  frame: ReturnType<typeof chinaPowerAnnualFrame>;
  region: string;
  analysisHref?: string;
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
      <section className={styles.mix} aria-label="省级前五">
        <h3>省级前五</h3>
        {leading.map(item => (
          <button key={item.code} type="button" aria-pressed={region === item.code} onClick={() => onRankSelect(item.code)}>
            <span>{item.name}</span><strong>{powerAmount.format(item.value)}</strong>
            <progress aria-label={item.name} value={item.value} max={maximum} />
          </button>
        ))}
      </section>
      <footer>
        <a href={frame.source} target="_blank" rel="noreferrer">中国电力统计年鉴 2024 · {frame.table} <ArrowUpRight size={12} aria-hidden="true" /></a>
        {analysisHref ? <a href={analysisHref}>装机与结构 <ArrowUpRight size={12} aria-hidden="true" /></a> : null}
        <span>统计覆盖 31 个省级地区</span>
      </footer>
    </section>
  );
}

function PowerMapLegend({ frame }: { frame: ProvincePowerFrame }) {
  const maximum = provincePowerMax(frame);
  if (maximum <= 0) return null;
  return (
    <div className={styles.legend} aria-label="省级地图图例">
      <div className={styles.scale} aria-hidden="true" />
      <div><span>0</span><span>{powerAmount.format(maximum)} {frame.unit}</span></div>
      {frame.regions.some(item => item.value == null) ? <span className={styles.missing}>暂无数据</span> : null}
    </div>
  );
}

export function PowerMonthlyPanel({ frame, data, region, category, analysisHref, onRegionChange, onMonthChange, onCategory }: {
  frame: ProvincePowerFrame;
  data: MonthlyData;
  region: string;
  category: string;
  analysisHref?: string;
  onRegionChange: (region: string) => void;
  onMonthChange: (month: string) => void;
  onCategory: (id: string) => void;
}) {
  const monthlyReport = data.versionUnavailable ? undefined : monthly.find(item => item.date === data.month);
  const local = frame.regions.find(item => item.code === region);
  const selected = chinaProvinces.find(item => item.code === region);
  const product = generationSeries.find(item => item.id === category) ?? generationSeries[0];
  const publishedValue = product.id === "electricity" ? data.total : data.composition.find(item => item.id === product.id)?.value;
  const breakdown = data.published ? data.composition : monthlyReport ? generationSeries.slice(1).map(item => ({
    ...item, value: monthlyReport.values[item.id] ?? null,
  })) : [];
  const maximum = Math.max(...breakdown.map(item => item.value ?? 0), 1);
  const total = selected ? local?.value : data.published ? publishedValue : monthlyReport?.values[product.id];
  const source = data.published ? "https://data.stats.gov.cn/easyquery.htm?cn=" + (selected ? "E0101" : "A01") : monthlyReport?.source;
  const yoy = selected ? null : data.published
    ? product.id === "electricity" ? data.yoy : null : monthlyReport?.yoy[product.id];
  const monthlyStatus = data.versionUnavailable ? "该发布版本暂不可读取。"
    : data.publishedPending || (selected && data.regionalPending) ? "正在读取月度发布数据…"
    : selected && total == null ? "该省本月暂无同口径数据。"
    : frame.regions.every(item => item.value == null) ? "暂无可用的分省月度发布数据，可切换到年度合计。"
    : null;

  return (
    <section className={styles.panel} aria-label="月度发电量">
      <div className={styles.filters}>
        <WorkspaceFilterSelect label="统计月份" value={data.month}
          options={data.months.toReversed().map(value => ({ value, label: value }))} onChange={onMonthChange} />
        <WorkspaceFilterSelect label="地区" value={region} options={filterOptions} onChange={onRegionChange} />
      </div>
      <header>
        <span>{data.month || "月度发布"} · {product.name}</span>
        <h2>{selected?.name ?? "中国全国"}</h2>
      </header>
      <div className={styles.stat} aria-live="polite">
        <strong>{total == null ? "—" : powerAmount.format(total)}</strong><span>{frame.unit}</span>
        {typeof yoy === "number" ? <span className={styles.yoy}>同比 {yoy > 0 ? "+" : ""}{powerAmount.format(yoy)}%</span> : null}
      </div>
      {monthlyStatus ? <p className={styles.note}>{monthlyStatus}</p> : null}
      <PowerMapLegend frame={frame} />
      <section className={styles.mix} aria-label="全国电源结构">
        <h3>全国已公布分项</h3>
        {breakdown.length ? breakdown.map(item => (
          <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>
            <span>{item.name}</span><strong>{item.value == null ? "—" : powerAmount.format(item.value)}</strong>
            <progress aria-label={item.name} value={item.value ?? 0} max={maximum} />
          </button>
        )) : <p className={styles.note}>本期未公布分电源统计。</p>}
      </section>
      <footer>
        {source ? <a href={source} target="_blank" rel="noreferrer">国家统计局 · 规模以上工业 <ArrowUpRight size={12} aria-hidden="true" /></a> : null}
        {analysisHref ? <a href={analysisHref}>月度分析与省际对照 <ArrowUpRight size={12} aria-hidden="true" /></a> : null}
        {data.published ? <span>发布版本 {data.published.version.slice(0, 12)}</span> : null}
      </footer>
    </section>
  );
}

export function PowerRegionPanel({ view, data, region, year, category, analysisHref, onYearChange, onRegionChange,
  onMonthChange, onCategory }: {
  view: Exclude<PowerView, "facilities">;
  data: MonthlyData;
  region: string;
  year: number | undefined;
  category: string;
  analysisHref: string;
  onYearChange: (year: number) => void;
  onRegionChange: (region: string) => void;
  onMonthChange: (month: string) => void;
  onCategory: (id: string) => void;
}) {
  if (view === "capacity") {
    return <PowerAnnualPanel frame={chinaPowerAnnualFrame("capacity", year)} region={region} analysisHref={analysisHref}
      onYearChange={onYearChange} onRegionChange={onRegionChange} onRankSelect={onRegionChange} />;
  }

  const frame: ProvincePowerFrame = {
    label: "月度发电量",
    unit: "亿千瓦时",
    period: data.month || "月度发布",
    regions: data.regional?.regions ?? [],
  };
  return <PowerMonthlyPanel frame={frame} data={data} region={region} category={category} analysisHref={analysisHref}
    onRegionChange={onRegionChange} onMonthChange={onMonthChange} onCategory={onCategory} />;
}
