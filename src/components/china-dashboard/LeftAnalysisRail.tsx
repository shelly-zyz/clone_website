import type { ChinaDashboardOverview } from "@/lib/china-dashboard";
import type { RegionSummary, RegionTheme } from "@/lib/regions/contracts";
import styles from "./china-dashboard.module.css";

function compact(value: number | null, divisor: number) {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / divisor);
}

function compactMetric(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

const themeCopy: Record<RegionTheme, { title: string; body: string }> = {
  power: { title: "设施与容量样本", body: "地图中的设施数量和容量只代表已映射公开样本；官方年度总量单独列示。" },
  weather: { title: "数值天气摘要", body: "区域值按有效网格面积加权；它来自 GFS 预报，不是地面站实测。" },
  carbon: { title: "网格排放估算", body: "省域结果保留源数据单位 kgC/h；它不是实时电力碳强度。" },
};

export function LeftAnalysisRail({ overview, scope, theme, summary }: { overview: ChinaDashboardOverview | null; scope: string; theme: RegionTheme; summary: RegionSummary | null }) {
  const official = overview?.official;
  const sample = overview?.mappedSample;

  return (
    <aside className={`${styles.rail} ${styles.leftRail}`} aria-label="全国电力分析">
      <section className={styles.leftBand}>
        <p className={styles.eyebrow}>NATIONAL BENCHMARK</p>
        <div className={styles.sectionHead}><h2>全国电力总览</h2><span className={styles.identity}>官方统计</span></div>
        <div className={styles.kpiGrid}>
          <div><strong>{official ? compact(official.installedCapacityMw.total, 100_000) : "…"}</strong><span>亿千瓦 · 2024 全国装机</span></div>
          <div><strong>{official ? compact(official.generationGwh.total, 100) : "…"}</strong><span>亿千瓦时 · 2024 发电量</span></div>
          <div><strong>{official ? `${Math.round(official.installedCapacityMw.solar / 1_000)}` : "…"}</strong><span>GW · 光伏装机</span></div>
          <div><strong>{official ? `${Math.round(official.installedCapacityMw.wind / 1_000)}` : "…"}</strong><span>GW · 风电装机</span></div>
        </div>
        <p className={styles.explain}>年度官方总量用于宏观校验，不拆成设施坐标或分钟级曲线。</p>
      </section>

      <section className={styles.leftBand}>
        <p className={styles.eyebrow}>CURRENT CONTEXT</p>
        <div className={styles.sectionHead}><h2>{scope} · {themeCopy[theme].title}</h2><span className={`${styles.identity} ${styles.amber}`}>{summary?.status === "available" ? "可用" : "核查中"}</span></div>
        <div className={styles.sampleLead}>
          <strong>{summary?.metrics[0]?.value == null ? "—" : compactMetric(summary.metrics[0].value)}</strong>
          <span>{summary?.metrics[0] ? `${summary.metrics[0].label} · ${summary.metrics[0].unit}` : "等待地区摘要"}</span>
        </div>
        <p className={styles.warning}>{summary?.missingReason ?? themeCopy[theme].body}</p>
      </section>

      <section className={styles.leftBand}>
        <p className={styles.eyebrow}>DATA QUALITY</p>
        <div className={styles.sectionHead}><h2>覆盖与口径</h2><span className={`${styles.identity} ${styles.gray}`}>可追溯</span></div>
        <dl className={styles.qualityList}>
          <div><dt>地区</dt><dd>{summary?.request.regionName ?? scope}</dd></div>
          <div><dt>覆盖</dt><dd>{summary?.coverage.label ?? "正在读取"}</dd></div>
          <div><dt>时间</dt><dd>{summary?.source.timeRange ?? "—"}</dd></div>
        </dl>
      </section>

      <section className={styles.leftBand}>
        <p className={styles.eyebrow}>SOURCE & LIMITS</p>
        <div className={styles.sectionHead}><h2>数据说明</h2><span className={`${styles.identity} ${styles.purple}`}>按需展开</span></div>
        <details className={styles.sourceDetails}>
          <summary>{summary?.source.name ?? "等待地区数据"}</summary>
          <p>{summary?.source.limitation ?? "地区、专题与来源会在完成查询后统一显示。"}</p>
        </details>
        {theme === "power" ? <p className={styles.explain}>{sample?.note ?? "年度官方总量与设施坐标样本分开呈现。"}</p> : null}
      </section>
    </aside>
  );
}
