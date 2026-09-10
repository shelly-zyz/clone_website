import type { ChinaDashboardOverview } from "@/lib/china-dashboard";
import styles from "./china-dashboard.module.css";

function compact(value: number | null, divisor: number) {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / divisor);
}

export function LeftAnalysisRail({ overview, scope }: { overview: ChinaDashboardOverview | null; scope: string }) {
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
        <p className={styles.eyebrow}>MAPPED ASSET SAMPLE</p>
        <div className={styles.sectionHead}><h2>{scope}公开设施</h2><span className={`${styles.identity} ${styles.amber}`}>映射样本</span></div>
        <div className={styles.sampleLead}>
          <strong>{scope === "全国" && sample?.count !== null ? sample?.count.toLocaleString("zh-CN") : "—"}</strong>
          <span>{scope === "全国" ? "条可查询电源项目" : "等待省级空间查询"}</span>
        </div>
        <div className={styles.sampleBar}><span style={{ width: sample?.status === "available" ? "82%" : "18%" }} /></div>
        <p className={styles.warning}>{scope === "全国" ? sample?.note ?? "正在读取地图样本数据库…" : "省级无结果只表示当前样本未覆盖，不能解释为官方统计为零。"}</p>
      </section>

      <section className={styles.leftBand}>
        <p className={styles.eyebrow}>NETWORK SNAPSHOT</p>
        <div className={styles.sectionHead}><h2>OSM 电网快照</h2><span className={`${styles.identity} ${styles.gray}`}>众包地图</span></div>
        <div className={styles.osmGrid}>
          <div><b>199,001</b><span>输电线路</span></div><div><b>37,069</b><span>变电站</span></div>
          <div><b>14,644</b><span>电厂面</span></div><div><b>753,493</b><span>发电单元</span></div>
        </div>
      </section>

      <section className={styles.leftBand}>
        <p className={styles.eyebrow}>SCENARIO CONTEXT</p>
        <div className={styles.sectionHead}><h2>长期情景轨迹</h2><span className={`${styles.identity} ${styles.purple}`}>模型情景</span></div>
        <svg className={styles.scenarioChart} viewBox="0 0 280 88" role="img" aria-label="长期情景结构示意，不是实时预测">
          <path d="M0 69H280M0 44H280M0 19H280" className={styles.gridLine} />
          <path d="M0 68 C42 63 70 62 102 53 S164 37 202 29 S244 15 280 12" className={styles.scenarioArea} />
          <path d="M0 68 C42 63 70 62 102 53 S164 37 202 29 S244 15 280 12" className={styles.scenarioTrace} />
        </svg>
        <div className={styles.chartLabels}><span>2021</span><span>2030</span><span>2045</span><span>2060</span></div>
        <p className={styles.explain}>GFDL-ESM4 SSP1-2.6 仅作长期气候—VRE 情景，不是当前实际发电。</p>
      </section>
    </aside>
  );
}
