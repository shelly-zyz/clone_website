"use client";

import { useEffect, useState } from "react";
import { useAnalysisJob, type LoadAnalysis } from "@/hooks/use-analysis-job";
import type { ForecastOverview, ForecastOverviewTopic } from "@/lib/globe-forecast";
import type { XiaoyunAnalysisArtifact } from "@/lib/xiaoyun/contracts";
import { ForecastSeries, ForecastSidebar, formatForecastDate } from "./ForecastSidebar";
import styles from "./ForecastSidebar.module.css";

const settings = {
  weather: { title: "全球 10 米风速", detail: "GFS · 格点平均值" },
  power: { title: "全国月度发电量", detail: "国家统计局 · 本期值", grain: "month", horizon: "1 个月" },
  carbon: { title: "电力部门碳排放速率", detail: "GRACED Power · 全球", grain: "day", horizon: "3 天" },
} as const;

const jobStatus = { queued: "已排队", running: "计算中", succeeded: "已完成", failed: "任务失败" };

export type LoadForecastOverview = (topic: ForecastOverviewTopic, signal: AbortSignal) => Promise<ForecastOverview>;

function ForecastTask({ task, loadAnalysis }: { task: XiaoyunAnalysisArtifact; loadAnalysis: LoadAnalysis }) {
  const { job, notice, retry } = useAnalysisJob(task, loadAnalysis);
  const result = job?.result;
  const grain = task.topic === "power" ? "month" : "day";
  const cutoff = job?.data_ref.time_range?.end;
  return (
    <section className={styles.result} aria-label="预测结果">
      <h3>{result?.metric ?? "预测结果"}</h3>
      <p className={styles.muted} role="status">
        {job ? jobStatus[job.status] : "正在读取任务…"}
        {cutoff && ` · 数据截至 ${formatForecastDate(cutoff, grain)}`}
      </p>
      {job?.status === "failed" && <p role="alert" className={styles.error}>{job.error ?? "预测任务未完成。"}</p>}
      {result?.points && <ForecastSeries points={result.points} unit={result.unit} grain={grain} label="模型预测值" />}
      {result?.model && (
        <p className={styles.source}>
          {result.model.method ?? result.model.name} {result.model.version} · 数据版本 {job?.data_ref.version.slice(0, 12)}
        </p>
      )}
      {notice && <>
        <p className={styles.status} role="status">{notice}</p>
        <button className={styles.action} type="button" onClick={retry}>刷新任务</button>
      </>}
    </section>
  );
}

export function WorkspaceForecast({ topic, loadOverview, task, loadAnalysis, onRun, pending, notice, ready }: {
  topic: ForecastOverviewTopic;
  loadOverview: LoadForecastOverview;
  task?: XiaoyunAnalysisArtifact;
  loadAnalysis: LoadAnalysis;
  onRun: (message: string) => void;
  pending: boolean;
  notice?: string;
  ready: boolean;
}) {
  const [overview, setOverview] = useState<ForecastOverview>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    void loadOverview(topic, signal)
      .then((data) => { if (!controller.signal.aborted) setOverview(data); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法读取预测数据。");
      });
    return () => controller.abort();
  }, [loadOverview, topic, refresh]);

  const config = settings[topic];
  const latest = overview?.points.findLast(({ value }) => value !== null);
  const training = overview?.training;
  const grain = topic === "power" ? "month" : "day";
  const horizon = topic === "power" ? settings.power.horizon : settings.carbon.horizon;
  const weather = topic === "weather";
  const issued = overview?.issueTime;
  function run() {
    if (!training) return;
    const start = training.start.slice(0, 10);
    const end = training.end.slice(0, 10);
    const series = topic === "power" ? "国家统计局全国月度发电量本期值" : "GRACED Power 全球日帧格点排放速率合计";
    onRun(`请查询 ${start} 到 ${end} 的${series}，使用 StatsForecast 从这段连续观测末尾预测 ${horizon}，直接提交预测任务。`);
  }

  return (
    <ForecastSidebar topic={topic}>
      <h3>{config.title}</h3>
      <p className={styles.muted}>{config.detail}</p>
      {!overview && (
        <p className={styles.status} role="status">{error || "正在读取预测数据…"}</p>
      )}
      {error && (
        <button className={styles.action} type="button" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>
          重试
        </button>
      )}
      {overview && !latest && <p className={styles.status}>暂无已发布的{weather ? "预报" : "观测"}。</p>}
      {overview && latest && (weather ? <>
        {issued && <p className={styles.status}>{overview.historicalIssue ? "历史起报" : "起报"} {formatForecastDate(issued, "hour")}</p>}
        <ForecastSeries points={overview.points} unit={overview.unit} grain="hour" label="GFS 预报有效时刻与风速" />
      </> : <>
        <p className={styles.status}>观测截至 {formatForecastDate(latest.date, grain)}</p>
        {!task && <ForecastSeries points={overview.points.slice(-8)} observed unit={overview.unit} grain={grain} label="近期观测值" />}
        {training ? <>
          <p className={styles.muted}>
            训练窗口 {formatForecastDate(training.start, grain)} 至 {formatForecastDate(training.end, grain)}
          </p>
          <button className={styles.action} type="button" disabled={pending || !ready} onClick={run}>
            {pending ? "正在提交预测…" : `预测 ${horizon}`}
          </button>
          {!ready && <p className={styles.muted}>小云连接后可提交预测。</p>}
        </> : (
          <p className={styles.muted}>末尾连续观测 {overview.continuous ?? 0} 期。预测需要至少 8 期连续观测。</p>
        )}
      </>)}
      {overview && <p className={styles.source}>来源 {overview.source} · 版本 {overview.version.slice(0, 12)}</p>}
      {notice && <p className={styles.status} role="status">{notice}</p>}
      {task && <ForecastTask key={task.jobId} task={task} loadAnalysis={loadAnalysis} />}
    </ForecastSidebar>
  );
}
