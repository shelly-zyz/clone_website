"use client";

import { useState } from "react";
import type { PredictionModelRegistry, PredictionRealBaselineBacktest, PredictionStatus } from "@/lib/prediction/contracts";
import type { RegionSummary, RegionTheme } from "@/lib/regions/contracts";
import { PredictionResultPanel } from "./PredictionResultPanel";
import styles from "./china-dashboard.module.css";

const identityLabels: Record<RegionSummary["identity"], string> = {
  "mapped-asset-sample": "地图样本",
  forecast: "天气预报",
  "research-estimate": "研究估算",
};

const themeLabels: Record<RegionTheme, string> = { power: "电力", weather: "气象", carbon: "碳排放" };

function valueLabel(value: number | null, unit: string) {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("zh-CN", { notation: Math.abs(value) >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function RegionAnalysisRail({ summary, loading, error, theme, status, registry, realBacktest }: {
  summary: RegionSummary | null;
  loading: boolean;
  error: string | null;
  theme: RegionTheme;
  status: PredictionStatus | null;
  registry: PredictionModelRegistry | null;
  realBacktest: PredictionRealBaselineBacktest | null;
}) {
  const [tab, setTab] = useState<"analysis" | "research">("analysis");

  return (
    <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="地区分析">
      <div className={styles.analysisTabs} role="tablist" aria-label="分析视图">
        <button type="button" role="tab" aria-selected={tab === "analysis"} onClick={() => setTab("analysis")}>地区分析</button>
        <button type="button" role="tab" aria-selected={tab === "research"} onClick={() => setTab("research")}>研究回测</button>
      </div>

      {tab === "research" ? (
        <div className={styles.researchRailBody}>
          <div className={styles.analysisHead}>
            <div><p className={styles.eyebrow}>METHOD EVIDENCE</p><h2>预测方法验证</h2></div>
            <span className={`${styles.identity} ${styles.purple}`}>非正式预测</span>
          </div>
          <p className={styles.analysisIntro}>回测证据按真实地域和数据集展示，不随当前省份切换，也不代表该省未来出力。</p>
          <PredictionResultPanel status={status} registry={registry} realBacktest={realBacktest} />
        </div>
      ) : (
        <div className={styles.analysisBody}>
          <div className={styles.analysisHead}>
            <div><p className={styles.eyebrow}>REGION SUMMARY</p><h2>{summary?.request.regionName ?? "地区"} · {themeLabels[theme]}</h2></div>
            {summary ? <span className={styles.identity}>{identityLabels[summary.identity]}</span> : null}
          </div>

          {loading ? <div className={styles.analysisState}>正在汇总边界内的真实数据…</div> : null}
          {!loading && error ? <div className={`${styles.analysisState} ${styles.analysisError}`}>{error}</div> : null}
          {!loading && !error && summary?.status === "unavailable" ? (
            <div className={styles.emptyAnalysis}><strong>当前没有可用数据</strong><p>{summary.missingReason}</p></div>
          ) : null}

          {!loading && !error && summary?.status === "available" ? (
            <>
              <div className={styles.analysisMetrics}>
                {summary.metrics.slice(0, 3).map((item) => (
                  <article key={item.id}><span>{item.label}</span><strong>{valueLabel(item.value, item.unit)}</strong></article>
                ))}
              </div>

              {summary.breakdown.length ? (
                <section className={styles.analysisSection}>
                  <div className={styles.sectionHead}><h3>技术结构</h3><span>按映射设施数量</span></div>
                  <div className={styles.breakdownList}>
                    {summary.breakdown.slice(0, 6).map((item) => (
                      <div key={item.id}>
                        <p><span>{item.label}</span><b>{item.value.toLocaleString("zh-CN")} {item.unit}</b></p>
                        <div><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, item.share ?? 0))})` }} /></div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {summary.details.length ? (
                <section className={styles.analysisSection}>
                  <div className={styles.sectionHead}><h3>关键明细</h3></div>
                  <dl className={styles.detailList}>{summary.details.map((item) => <div key={`${item.label}-${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                </section>
              ) : null}
            </>
          ) : null}

          {summary ? (
            <section className={styles.sourceCard}>
              <div><span>来源</span><strong>{summary.source.name}</strong></div>
              <div><span>时间</span><strong>{summary.source.timeRange}</strong></div>
              <div><span>覆盖</span><strong>{summary.coverage.label}</strong></div>
              <p>{summary.source.limitation}</p>
            </section>
          ) : null}
        </div>
      )}
    </aside>
  );
}
