import styles from "./china-dashboard.module.css";
import type { PredictionModelRegistry, PredictionStatus } from "@/lib/prediction/contracts";
import { derivePredictionWorkflow } from "@/lib/prediction/workflow";

function WorkProduct({ kind }: { kind: string }) {
  if (kind === "matrix") return <svg className={styles.workProduct} viewBox="0 0 180 38" preserveAspectRatio="none" aria-label="彩色质量编码矩阵结构示意"><g>{Array.from({ length: 24 }, (_, index) => <rect key={index} x={5 + (index % 8) * 21} y={4 + Math.floor(index / 8) * 10} width="19" height="8" fill={["#1b5f8c", "#20bfa9", "#f2c94c", "#ff6b8a", "#7c5cff", "#4ade80"][index % 6]} opacity={0.72 + (index % 3) * 0.12} />)}</g></svg>;
  if (kind === "network") return <svg className={styles.workProduct} viewBox="0 0 180 38" preserveAspectRatio="none" aria-label="彩色模型网络结构示意"><g stroke="currentColor" opacity=".7"><path d="M22 10L70 19L116 8M22 28L70 19L116 19M70 19L116 30L158 19" /></g><g fill="currentColor">{[[18,10],[18,28],[70,19],[116,8],[116,19],[116,30],[158,19]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" />)}</g></svg>;
  if (kind === "bars") return <svg className={styles.workProduct} viewBox="0 0 180 38" preserveAspectRatio="none" aria-label="彩色历史时序样本库结构示意"><g>{[0,1,2].map((row) => <g key={row}>{[0,1,2,3,4,5].map((col) => <rect key={col} x={8 + col * 27 + row * 5} y={4 + row * 11} width={22} height="7" fill={["#ffb703","#2ee9ff","#ff5ea8","#a7f542","#9b8cff","#ff6b57"][col]} opacity={0.45 + row * .2} />)}</g>)}</g></svg>;
  if (kind === "fan") return <svg className={styles.workProduct} viewBox="0 0 180 38" preserveAspectRatio="none" aria-label="彩色概率扇形图结构示意"><path d="M0 28L20 22L40 25L60 13L80 17L100 8L120 14L140 7L160 11L180 8V23L160 19L140 22L120 20L100 25L80 27L60 23L40 31L20 28L0 34Z" fill="#ff6b57" opacity=".26" /><path d="M0 30L20 25L40 28L60 18L80 22L100 16L120 18L140 14L160 16L180 13" fill="none" stroke="#50e3ff" strokeWidth="2" /><path d="M0 26L20 23L40 25L60 16L80 20L100 13L120 17L140 11L160 14L180 10" fill="none" stroke="#ffd166" strokeWidth="1.5" /></svg>;
  return <svg className={styles.workProduct} viewBox="0 0 180 38" preserveAspectRatio="none" aria-label="彩色时序曲线结构示意"><path d="M0 29L18 24L36 27L54 13L72 20L90 8L108 15L126 10L144 20L162 7L180 13" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M0 33L24 29L48 21L72 25L96 17L120 23L144 12L180 18" fill="none" stroke="#ffd166" strokeWidth="1.6" /></svg>;
}

export function PredictionWorkflowRail({ currentStep, scope, status, registry, currentWeatherAvailable }: {
  currentStep: number;
  scope: string;
  status: PredictionStatus | null;
  registry: PredictionModelRegistry | null;
  currentWeatherAvailable: boolean;
}) {
  const stages = derivePredictionWorkflow(status, currentWeatherAvailable, registry);
  const evidence = status?.researchEvidence;
  const realData = status?.realData;
  return (
    <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="超短期预测链像素工厂">
      <div className={styles.workflowHead}>
        <div><p className={styles.eyebrow}>PIXEL FORECAST FACTORY</p><h2>超短期预测链</h2></div>
        <span className={`${styles.identity} ${styles.red}`}>生产预测锁定</span>
      </div>
      <p className={styles.workflowWarning}>{realData?.status === "verified-research-only"
        ? `真实数据门禁：${realData.dataset.trainingPairRows?.toLocaleString() ?? "?"}条小时配对，最佳90天完整率${realData.quality.best90DayCompleteness == null ? "未知" : `${(realData.quality.best90DayCompleteness * 100).toFixed(2)}%`}；${realData.quality.invalidHourlyWindows ?? 0}个质量异常小时已隔离，生产门禁锁定。`
        : realData
          ? "服务器真实预测数据证据暂时无法核验；预测保持锁定，不输出替代值。"
          : evidence
            ? `状态API：SDWPF历史回测 ${evidence.dataset.dayCount}天、${evidence.dataset.intervalMinutes}分钟粒度。研究证据与生产数据分离，生产门禁锁定。`
            : `当前范围：${scope}。每个工位会产出彩色结构示意；真实功率与历史 NWP 未通过、预测尚未接入前，不输出预测值。`}</p>
      <div className={styles.forecastFactory}>
        {stages.map((stage, index) => {
          const current = currentStep === index && stage.state !== "locked";
          const stateClass = stage.state === "complete" ? styles.completeStage : stage.state === "research" ? styles.researchStage : styles.lockedStage;
          const statusLabel = stage.state === "locked" ? "门禁锁定" : current ? (stage.state === "research" ? "历史回测演示" : "数据工位巡检") : (stage.state === "research" ? "研究产物已生成" : "真实输入已就绪");
          return (
            <article key={stage.title} data-state={stage.state} className={`${styles.factoryStage} ${styles[`stageTone${index + 1}`]} ${stateClass} ${current ? styles.currentStage : ""}`}>
              <span className={styles.stageIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.stageCopy}><b>{stage.title}</b><span>{stage.detail}</span></div>
              <div className={styles.workcell} aria-label={`像素风小人：${statusLabel}`}>
                <span className={`${styles.pixelWorker} ${styles.workerA}`}><i /><b /><em /></span>
                <span className={`${styles.pixelWorker} ${styles.workerB}`}><i /><b /><em /></span>
                <span className={styles.workbench} />
              </div>
              <div className={styles.stageOutput}>
                <span><b>{stage.product}</b><small>{stage.note}</small></span>
                <WorkProduct kind={stage.kind} />
              </div>
              <span className={styles.workStatus}>{statusLabel}</span>
            </article>
          );
        })}
      </div>
      <div className={styles.factoryNote}><span><b>{scope} · 状态接口驱动</b> 锁定工位停止作业</span><span>{realData ? "真实SCADA · 历史NWP · 研究回测" : evidence ? "真实SCADA · 历史留出回测" : "等待预测状态"}</span></div>
    </aside>
  );
}
