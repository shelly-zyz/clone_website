"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Cloud, Gauge, LayoutDashboard, Layers3, Moon, Sun, Table2, Zap } from "lucide-react";
import {
  CarbonBadge,
  CarbonBreakdown,
  CarbonButton,
  CarbonEvidence,
  CarbonMetric,
  CarbonPanel,
  CarbonSelect,
  CarbonState,
  CarbonTable,
  CarbonTheme,
  CarbonTrend,
  type CarbonColumn,
  type CarbonTone,
} from "@/components/carbon-ui";
import styles from "./library-preview.module.css";

const sources = [
  { id: "gas", label: "天然气", scope: "范围一", tone: "carbon" },
  { id: "power", label: "外购电力", scope: "范围二", tone: "energy" },
  { id: "travel", label: "差旅与通勤", scope: "范围三", tone: "info" },
] as const;

type SourceId = typeof sources[number]["id"];
type LedgerRow = typeof sources[number] & { value: number };
type Inventory = { electricity: number; floorArea: number; emissions: Record<SourceId, readonly number[]> };

const inventories: Record<string, Inventory> = {
  "2025": {
    electricity: 12.64,
    floorArea: 211000,
    emissions: {
      gas: [105, 98, 93, 72, 63, 54, 52, 49, 57, 71, 89, 101],
      power: [647, 588, 658, 636, 677, 719, 785, 744, 634, 587, 610, 653],
      travel: [44, 35, 64, 61, 57, 56, 32, 24, 63, 69, 63, 52],
    },
  },
  "2024": {
    electricity: 13.31,
    floorArea: 211000,
    emissions: {
      gas: [117, 107, 102, 82, 69, 61, 56, 52, 62, 78, 96, 109],
      power: [705, 616, 706, 690, 701, 745, 826, 809, 676, 635, 638, 698],
      travel: [39, 31, 58, 56, 61, 58, 29, 22, 59, 65, 60, 50],
    },
  },
};

const years = Object.keys(inventories).reverse().map((value) => ({ value, label: value + " 年" }));
const scopeOptions = [
  { value: "all", label: "全部范围" },
  ...sources.map(({ id, scope }) => ({ value: id, label: scope })),
];

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const unit = "tCO₂e";
const columns: CarbonColumn<LedgerRow>[] = [
  { key: "source", title: "排放源", render: (row) => row.label },
  { key: "scope", title: "核算范围", render: (row) => row.scope },
  { key: "amount", title: `排放量（${unit}）`, align: "end", render: (row) => number.format(row.value) },
  { key: "quality", title: "数据类型", render: () => <CarbonBadge tone="info">示例数据</CarbonBadge> },
];

const badges: { tone: CarbonTone; label: string }[] = [
  { tone: "energy", label: "已核验" },
  { tone: "carbon", label: "待复核" },
  { tone: "info", label: "估算" },
  { tone: "danger", label: "数据异常" },
  { tone: "neutral", label: "未提交" },
];

const navItems = [
  { id: "overview", label: "分析总览", icon: LayoutDashboard },
  { id: "ledger", label: "核算台账", icon: Table2 },
  { id: "states", label: "组件状态", icon: Layers3 },
];

export function LibraryPreview() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [year, setYear] = useState("2025");
  const [scope, setScope] = useState("all");

  const inventory = inventories[year];
  const visibleSources = sources.filter((source) => scope === "all" || source.id === scope);
  const rows = visibleSources.map((source) => ({
    ...source,
    value: inventory.emissions[source.id].reduce((total, value) => total + value, 0),
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const points = inventory.emissions.power.map((_, index) => ({
    label: `${index + 1}月`,
    value: visibleSources.reduce((sum, source) => sum + inventory.emissions[source.id][index], 0),
  }));
  const coverage = scopeOptions.find((option) => option.value === scope)?.label;

  return (
    <CarbonTheme theme={theme} className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.mark}><Layers3 size={19} aria-hidden="true" /></span>
          <div><strong>OpenGridWorks</strong><span>能碳 UI 组件库</span></div>
        </div>
        <CarbonButton
          appearance="secondary"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
        >
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <span>{theme === "dark" ? "浅色" : "深色"}</span>
        </CarbonButton>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav aria-label="组件预览">
            {navItems.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#${id}`}><Icon size={16} aria-hidden="true" />{label}</a>
            ))}
          </nav>
          <Link href="/" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />返回平台</Link>
        </aside>

        <main className={styles.main}>
          <section id="overview" className={styles.section} aria-labelledby="overview-title">
            <div className={styles.heading}>
              <div>
                <h1 id="overview-title">能碳分析组件</h1>
                <p>使用示例数据预览指标、图表和核算台账。</p>
              </div>
              <div className={styles.filters} role="group" aria-label="核算筛选">
                <CarbonSelect label="年度" value={year} options={years} onChange={(event) => setYear(event.target.value)} />
                <CarbonSelect label="范围" value={scope} options={scopeOptions} onChange={(event) => setScope(event.target.value)} />
              </div>
            </div>

            <div className={styles.metrics} aria-label="核心指标">
              <CarbonMetric label="碳排放量" value={number.format(total)} unit={unit} icon={<Cloud size={17} />} detail={coverage} tone="carbon" />
              <CarbonMetric label="用电量" value={number.format(inventory.electricity)} unit="GWh" icon={<Zap size={17} />} detail="全区域年度用电" tone="energy" />
              <CarbonMetric label="建筑碳排放强度" value={number.format(total * 1000 / inventory.floorArea)} unit="kgCO₂e/m²" icon={<Gauge size={17} />} detail="按建筑面积折算" tone="info" />
            </div>

            <div className={styles.charts}>
              <CarbonPanel
                appearance="dashboard"
                title="月度碳排放趋势"
                description={`${year} 年 · ${coverage} · ${unit}`}
                action={<span className={styles.chartLabel}><Activity size={14} aria-hidden="true" />月度汇总</span>}
              >
                <CarbonTrend label="月度碳排放" unit={unit} points={points} theme={theme} />
              </CarbonPanel>
              <CarbonPanel appearance="dashboard" title="排放范围构成" description={`${year} 年 · 占所选范围排放量`}>
                <CarbonBreakdown
                  label="各范围占比"
                  items={rows.map(({ scope, value, tone }) => ({ label: scope, value, tone }))}
                />
              </CarbonPanel>
            </div>
          </section>

          <section id="ledger" className={styles.section} aria-label="核算台账">
            <CarbonPanel
              title="核算台账"
              description={`${year} 年 · ${coverage} · ${rows.length} 条记录`}
              action={<CarbonButton appearance="secondary" onClick={() => { setYear("2025"); setScope("all"); }}>重置筛选</CarbonButton>}
            >
              <CarbonTable label="排放源明细" columns={columns} rows={rows} rowKey={(row) => row.id} />
              <CarbonEvidence>
                <p>示例数据按月汇总，排放量单位为吨二氧化碳当量（tCO₂e）。用电量展示全区域年度统计。</p>
              </CarbonEvidence>
            </CarbonPanel>
          </section>

          <section id="states" className={styles.section} aria-label="组件状态">
            <CarbonPanel title="组件状态" description="数据质量标签、加载、空数据和错误提示。">
              <div className={styles.badges}>
                {badges.map(({ tone, label }) => <CarbonBadge key={label} tone={tone}>{label}</CarbonBadge>)}
              </div>
              <div className={styles.states}>
                <CarbonState kind="loading" title="正在加载" description="正在读取核算结果" />
                <CarbonState kind="empty" title="暂无核算记录" description="可尝试切换统计年度" />
                <CarbonState kind="error" title="读取失败" description="数据服务暂不可用" />
              </div>
            </CarbonPanel>
          </section>
        </main>
      </div>
    </CarbonTheme>
  );
}
