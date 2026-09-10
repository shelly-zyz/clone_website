import type { PredictionModelRegistry, PredictionStatus } from "@/lib/prediction/contracts";
import { buildResearchEvaluationRows } from "@/lib/prediction/evaluation";
import styles from "./china-dashboard.module.css";

function formatMae(value: number) {
  return `${value.toFixed(2)} MW`;
}

function ResearchErrorChart({ modelMaeMw, baselineMaeMw, horizonMinutes }: {
  modelMaeMw: number;
  baselineMaeMw: number;
  horizonMinutes: number;
}) {
  const maximum = Math.max(modelMaeMw, baselineMaeMw, 1);
  return (
    <div className={styles.errorChart} aria-label={`${horizonMinutes}分钟模型与持久性基线误差对比`}>
      <span className={styles.errorBarModel} style={{ width: `${(modelMaeMw / maximum) * 100}%` }} />
      <span className={styles.errorBarBaseline} style={{ width: `${(baselineMaeMw / maximum) * 100}%` }} />
    </div>
  );
}

export function PredictionResultPanel({ status, registry }: {
  status: PredictionStatus | null;
  registry: PredictionModelRegistry | null;
}) {
  const evidence = status?.researchEvidence;
  const rows = evidence ? buildResearchEvaluationRows(evidence.metrics) : [];
  const realData = status?.realData?.status === "verified-research-only" ? status.realData : null;
  const completedFolds = registry?.promotionGate.completedFolds ?? 0;
  const minimumFolds = registry?.promotionGate.minimumFolds ?? 3;

  return (
    <section className={styles.researchPanel} aria-label="历史回测评估结果">
      <div className={styles.researchPanelHead}>
        <div><p className={styles.eyebrow}>BASELINE EVALUATION</p><strong>历史回测结果</strong></div>
        <span className={`${styles.identity} ${styles.purple}`}>研究模式</span>
      </div>
      {rows.length > 0 ? (
        <>
          <div className={styles.evaluationLegend}><span><i className={styles.legendModel} />候选模型</span><span><i className={styles.legendBaseline} />持久性基线</span><span>MAE / MW</span></div>
          <div className={styles.evaluationRows}>
            {rows.map((row) => (
              <div className={styles.evaluationRow} key={row.horizonMinutes}>
                <b>{row.horizonMinutes}m</b>
                <ResearchErrorChart modelMaeMw={row.modelMaeMw} baselineMaeMw={row.persistenceMaeMw} horizonMinutes={row.horizonMinutes} />
                <span className={row.passesRollingGate ? styles.evaluationPass : styles.evaluationReject}>
                  {row.meanRollingImprovementPct == null ? "单折" : `${row.meanRollingImprovementPct >= 0 ? "+" : ""}${row.meanRollingImprovementPct.toFixed(2)}%`}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.researchPanelMeta}>
            <span>滚动验证 {completedFolds}/{minimumFolds} 折</span>
            <span>最优候选 {rows.find((row) => row.passesRollingGate)?.horizonMinutes ?? "无"} 分钟</span>
            <span>区间层未校准</span>
          </div>
        </>
      ) : (
        <p className={styles.researchPanelEmpty}>暂无可审计的历史回测样本，保持锁定。</p>
      )}
      <p className={styles.researchPanelNote}>
        {realData
          ? `真实数据 ${realData.dataset.trainingPairRows?.toLocaleString() ?? "?"} 对 · 最佳90天 ${(realData.quality.best90DayCompleteness == null ? 0 : realData.quality.best90DayCompleteness * 100).toFixed(2)}% · ${realData.quality.invalidHourlyWindows ?? 0} 小时已隔离`
          : "SDWPF 结果仅用于方法回测"}
        <span>不生成正式预测 / P10 / P50 / P90</span>
      </p>
      {rows.length > 0 && <div className={styles.researchMaeSummary}>{rows.map((row) => <span key={row.horizonMinutes}>{row.horizonMinutes}m {formatMae(row.modelMaeMw)} / {formatMae(row.persistenceMaeMw)}</span>)}</div>}
    </section>
  );
}
