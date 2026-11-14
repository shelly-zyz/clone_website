"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown, Factory, Layers3, Zap } from "lucide-react";
import { useState } from "react";
import { chinaProvinces } from "@/lib/china-provinces";
import annual from "@/lib/topic-analysis/nbs-annual.json";
import monthly from "@/lib/topic-analysis/nbs-monthly.json";
import { generationSeries } from "@/lib/topic-analysis/history";
import type { useReportedGeneration } from "@/hooks/use-reported-generation";
import type { WorkspaceContext } from "@/lib/workspace-context";
import { WorkspaceFilterSelect } from "./WorkspaceSidebar";
import styles from "./PowerRegionPanel.module.css";

type PowerView = NonNullable<WorkspaceContext["powerView"]>;
type MonthlyData = ReturnType<typeof useReportedGeneration>;
const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const viewTabs = [
  { id: "facilities", label: "设施", icon: Factory },
  { id: "generation", label: "发电量", icon: Zap },
  { id: "capacity", label: "装机", icon: Layers3 },
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

export function PowerRegionPanel({
  view, data, region, year, category, analysisHref, onYearChange, onRegionChange, onMonthChange, onCategory,
}: {
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCapacity = view === "capacity";
  const annualReport = annual.find(item => item.year === year) ?? annual[annual.length - 1];
  const monthlyReport = data.versionUnavailable ? undefined : monthly.find(item => item.date === data.month);
  const local = data.regional?.regions.find(item => item.code === region);
  const product = generationSeries.find(item => item.id === category) ?? generationSeries[0];
  const fallbackValue = monthlyReport?.values[product.id];
  const publishedValue = product.id === "electricity" ? data.total : data.composition.find(item => item.id === product.id)?.value;
  const fallbackBreakdown = monthlyReport ? generationSeries.slice(1).map(item => ({
    ...item, value: monthlyReport.values[item.id] ?? null,
  })) : [];
  const breakdown = isCapacity
    ? generationSeries.slice(1).map((item, index) => ({ ...item, value: annualReport.capacityGw[index + 1] }))
    : data.published ? data.composition : fallbackBreakdown;
  const maximum = Math.max(...breakdown.map(item => item.value ?? 0), 1);
  const selected = chinaProvinces.find(item => item.code === region);
  const title = isCapacity ? "全国年末装机" : selected?.name ?? "中国全国";
  const total = isCapacity ? annualReport.capacityGw[0] : selected
    ? local?.value : data.published ? publishedValue : fallbackValue;
  const unit = isCapacity ? "GW" : "亿千瓦时";
  const source = isCapacity ? annualReport.source
    : data.published ? "https://data.stats.gov.cn/easyquery.htm?cn=" + (selected ? "E0101" : "A01") : monthlyReport?.source;
  const yoy = selected || isCapacity ? null : data.published
    ? product.id === "electricity" ? data.yoy : null : monthlyReport?.yoy[product.id];
  const date = isCapacity ? `${annualReport.year} 年` : data.month || "暂无月份";
  const details = selected ? `${selected.name} · ${date}` : date;
  const unavailable = selected && !data.regionalPending && (local?.value == null);

  return (
    <div className={styles.region} onKeyDown={event => { if (event.key === "Escape") setMobileOpen(false); }}>
      <button className={styles.trigger} type="button" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
        <Zap size={16} aria-hidden="true" /> 电力统计 <ChevronDown size={15} aria-hidden="true" />
      </button>
      <aside className={styles.panel} data-open={mobileOpen} aria-label="电力区域详情">
        <header><span>国家统计局 · {isCapacity ? "年度公报" : "规模以上工业"}</span>
          <h2>{title}</h2><p>{details}{isCapacity ? "" : " · " + product.name}</p>
        </header>
        <div className={styles.filters}>
          {isCapacity ? <WorkspaceFilterSelect label="统计年份" value={String(annualReport.year)}
            options={annual.toReversed().map(item => ({ value: String(item.year), label: item.year + " 年" }))}
            onChange={value => onYearChange(Number(value))} /> : <>
            <WorkspaceFilterSelect label="地区" value={region} options={filterOptions} onChange={onRegionChange} />
            <WorkspaceFilterSelect label="统计月份" value={data.month}
              options={data.months.toReversed().map(value => ({ value, label: value }))} onChange={onMonthChange} />
          </>}
        </div>
        <div className={styles.stat} aria-live="polite">
          <strong>{total == null ? "—" : amount.format(total)}</strong><span>{unit}</span>
          {typeof yoy === "number" ? <span className={styles.yoy}>同比 {yoy > 0 ? "+" : ""}{amount.format(yoy)}%</span> : null}
        </div>
        {unavailable ? <p className={styles.note}>该省本期暂无同口径发布值。</p> : null}
        {data.publishedPending && !isCapacity ? <p className={styles.note}>正在核对发布版本…</p> : null}
        {data.versionUnavailable && !isCapacity ? <p className={styles.note}>该发布版本暂不可读取。</p> : null}
        <section className={styles.mix} aria-label="全国电源结构">
          <h3>{isCapacity ? "全国装机构成" : "全国已公布分项"}</h3>
          {breakdown.length ? breakdown.map(item => (
            <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>
              <span>{item.name}</span><strong>{item.value == null ? "—" : amount.format(item.value)}</strong>
              <span className={styles.bar}><span style={{ width: `${(item.value ?? 0) / maximum * 100}%`, backgroundColor: item.color }} /></span>
            </button>
          )) : <p className={styles.note}>本期未公布分电源统计。</p>}
        </section>
        <footer>
          {source ? <a href={source} target="_blank" rel="noreferrer">统计来源 <ArrowUpRight size={12} /></a> : null}
          <Link href={analysisHref}>{isCapacity ? "装机与结构" : "月度分析与省际对照"} <ArrowUpRight size={14} /></Link>
          {!isCapacity && data.published ? <span>发布版本 {data.published.version.slice(0, 12)}</span> : null}
        </footer>
      </aside>
    </div>
  );
}
