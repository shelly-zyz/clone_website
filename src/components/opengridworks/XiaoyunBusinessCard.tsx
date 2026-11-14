"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import type { G2Spec } from "@antv/g2";
import type { IBarChartSpec, ILineChartSpec } from "@visactor/vchart";
import type { EChartsOption } from "echarts";
import { useEffect, useRef, useState } from "react";
import { useAnalysisJob, type AnalysisJob, type LoadAnalysis } from "@/hooks/use-analysis-job";
import type { XiaoyunAnalysisArtifact, XiaoyunBusinessResult } from "@/lib/xiaoyun/contracts";

type Chart = Extract<XiaoyunBusinessResult, { kind: "chart" }>;

const topics = { power: "电源地球", meteo: "气象地球", carbon: "碳排放地球" };
const renderers = { echarts: "ECharts", "mcp-echarts": "ECharts", vchart: "VChart", antv: "AntV G2" };
const operations = { describe: "描述统计", cluster: "聚类", forecast: "预测", backtest: "回测", compare: "模型对比", select_model: "滚动回测选模" };
const models = { statsforecast: "StatsForecast", timesfm: "TimesFM", chronos2: "Chronos-2" };
const statuses = { queued: "排队中", running: "计算中", succeeded: "已完成", failed: "任务失败" };
const formatNumber = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 8 });

function ChartPreview({ chart, size = "card" }: { chart: Chart; size?: "card" | "dialog" | "fullscreen" }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let disposed = false;
    let release: (() => void) | undefined;
    async function render(element: HTMLDivElement) {
      if (chart.renderer === "vchart") {
        const { default: VChart } = await import("@visactor/vchart");
        if (disposed) return;
        const view = new VChart(chart.options as unknown as ILineChartSpec | IBarChartSpec, { dom: element });
        release = () => { view.release(); };
        view.renderSync();
        return;
      }
      if (chart.renderer === "antv") {
        const { Chart: G2Chart } = await import("@antv/g2");
        if (disposed) return;
        const view = new G2Chart({ container: element, autoFit: true });
        release = () => view.destroy();
        await view.options(chart.options as G2Spec).render();
        return;
      }
      const { init } = await import("echarts");
      if (disposed) return;
      const view = init(element);
      release = () => view.dispose();
      view.setOption(chart.options as EChartsOption);
      const observer = new ResizeObserver(() => view.resize());
      observer.observe(element);
      release = () => { observer.disconnect(); view.dispose(); };
    }
    void render(host).catch(() => {
      if (!disposed) {
        release?.();
        release = undefined;
        setFailed(true);
      }
    });
    return () => {
      disposed = true;
      release?.();
    };
  }, [chart]);

  return (
    <div className="mt-2">
      <div ref={container} role="img" aria-label={`${renderers[chart.renderer]} 图表`}
        className={size === "fullscreen" ? "h-[58svh] min-h-64 w-full" : size === "dialog" ? "h-[42svh] min-h-60 w-full" : "h-60 w-full"} />
      {failed && <p role="alert" className="text-sm text-red-700">图表渲染失败，请重新生成。</p>}
      <p className="mt-2 text-xs text-slate-600">{renderers[chart.renderer]} · 数据版本 {chart.version.slice(0, 12)}</p>
    </div>
  );
}

export function XiaoyunDashboardDialog({ chart, onClose }: { chart: Chart; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const details = chart.dashboard;
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  if (!details) return null;
  const { start, end } = details.timeRange;
  const coverage = start && end && start !== end ? `${start} 至 ${end}` : start ?? end ?? "未提供";

  return (
    <dialog ref={dialog} aria-label={chart.title} onClose={onClose} data-astryx-theme="neutral"
      className={`fixed inset-0 m-auto overflow-auto bg-slate-50 p-4 text-slate-900 scheme-light backdrop:bg-slate-950/55 sm:p-6 ${
        fullscreen ? "h-[100svh] max-h-none w-screen max-w-none" : "max-h-[90svh] w-11/12 max-w-5xl rounded-xl shadow-2xl"
      }`}>
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold sm:text-3xl">{chart.title}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" label={fullscreen ? "退出全屏" : "全屏查看看板"}
              onClick={() => setFullscreen(value => !value)} />
            <Button size="sm" variant="secondary" label="关闭看板" onClick={() => dialog.current?.close()} />
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["单位", details.unit], ["有效观测", details.validRows], ["缺测", details.missingRows], ["来源", details.sourceName]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
              <dt className="text-sm text-slate-600">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-slate-700">数据覆盖 {coverage}{details.truncated && " · 查询结果已截断"}</p>
        <div className="rounded-lg border border-slate-200 bg-white p-2 sm:p-4">
          <ChartPreview chart={chart} size={fullscreen ? "fullscreen" : "dialog"} />
        </div>
        {details.sources.length > 0 && <ul className="space-y-1 text-sm">
          {details.sources.map(({ url, title }) => (
            <li key={url}><a href={url} target="_blank" rel="noreferrer" className="text-sky-800 underline">{title} · {url}</a></li>
          ))}
        </ul>}
      </div>
    </dialog>
  );
}

function AnalysisDetails({ job }: { job: AnalysisJob }) {
  const { result } = job;
  if (!result) return null;
  const { points, evaluation, baseline, summary, groups, model, model_selection: modelSelection } = result;
  const hasActual = points?.some(({ actual }) => actual !== undefined);
  const hasInterval = points?.some(({ p10, p90 }) => p10 !== undefined && p90 !== undefined);
  const metrics = summary && [
    ["均值", summary.mean], ["中位数", summary.median], ["最小值", summary.min],
    ["最大值", summary.max], ["标准差", summary.stddev],
  ] as const;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">{result.metric}（{result.unit}）</p>
      <p className="text-slate-600">有效观测 {result.observed_rows} 条 · 缺测 {result.missing_rows} 条</p>
      {model && <p>模型 {model.method ?? model.name} · 版本 {model.version}</p>}
      {modelSelection && (
        <div>
          <p>按 MAE 选择 {modelSelection.selected_method === "baseline" ? modelSelection.baseline_method : modelSelection.selected_method}
            （{modelSelection.folds} 个回测窗口，每个 {modelSelection.horizon} 期）</p>
          {modelSelection.refit_fallback && <p>全样本拟合未完成，预测改用 {modelSelection.refit_fallback}。</p>}
          <ul>
            {modelSelection.candidates.map(candidate => (
              <li key={candidate.method}>{candidate.method === "baseline" ? modelSelection.baseline_method : candidate.method}
                {candidate.mae === undefined ? "：未能计算" : `：MAE ${formatNumber.format(candidate.mae)}`}
                {candidate.rmse === undefined ? "" : ` · RMSE ${formatNumber.format(candidate.rmse)}`}</li>
            ))}
          </ul>
        </div>
      )}
      {evaluation && <p>回测误差 MAE {formatNumber.format(evaluation.mae)} · RMSE {formatNumber.format(evaluation.rmse)}</p>}
      {baseline && <p>基线误差 MAE {formatNumber.format(baseline.mae)} · RMSE {formatNumber.format(baseline.rmse)}</p>}
      {metrics && (
        <dl className="grid grid-cols-2 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label}><dt className="text-slate-600">{label}</dt><dd>{formatNumber.format(value)}</dd></div>
          ))}
        </dl>
      )}
      {groups && (
        <ul className="space-y-1">
          {groups.map(({ group, center, count }) => (
            <li key={group}>第 {group} 组 · 中心值 {formatNumber.format(center)} · {count} 条</li>
          ))}
        </ul>
      )}
      {points && (
        <div className="overflow-x-auto">
          <table aria-label="预测数值" className="w-full text-left tabular-nums">
            <thead className="text-slate-600">
              <tr>
                <th scope="col" className="pr-2 font-medium">日期</th>
                <th scope="col" className="pr-2 font-medium">预测值</th>
                {hasActual && <th scope="col" className="pr-2 font-medium">实际值</th>}
                {hasInterval && <th scope="col" className="font-medium">P10–P90</th>}
              </tr>
            </thead>
            <tbody>
              {points.map(({ date, value, actual, p10, p90 }) => (
                <tr key={date} className="border-t border-slate-200">
                  <td className="whitespace-nowrap py-1 pr-2">{date.slice(0, 10)}</td>
                  <td className="pr-2">{formatNumber.format(value)}</td>
                  {hasActual && <td className="pr-2">{actual === undefined ? "—" : formatNumber.format(actual)}</td>}
                  {hasInterval && <td>{p10 === undefined || p90 === undefined ? "—" : `${formatNumber.format(p10)} – ${formatNumber.format(p90)}`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AnalysisProgress({ task, loadAnalysis }: { task: XiaoyunAnalysisArtifact; loadAnalysis: LoadAnalysis }) {
  const { job, notice, retry } = useAnalysisJob(task, loadAnalysis);

  return (
    <div className="mt-2 space-y-2">
      <p role="status" className="text-sm">
        {job ? `${operations[job.plan.operation]} · ${statuses[job.status]}` : "正在读取任务状态…"}
        {job?.plan.model && job.plan.operation !== "select_model" && ` · ${models[job.plan.model]}`}
      </p>
      {job?.status === "failed" && <p role="alert" className="text-sm text-red-700">{job.error ?? "分析任务未完成。"}</p>}
      {job?.status === "succeeded" && <AnalysisDetails job={job} />}
      {notice && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{notice}</span>
          <Button label="刷新状态" size="sm" variant="secondary" onClick={retry} />
        </div>
      )}
      {job && <p className="text-xs text-slate-600">数据版本 {job.data_ref.version.slice(0, 12)}</p>}
    </div>
  );
}

export function XiaoyunBusinessCard({ results, loadAnalysis, selectedChartId, onSelectChart, onOpenDashboard }: {
  results: XiaoyunBusinessResult[];
  loadAnalysis: LoadAnalysis;
  selectedChartId?: string;
  onSelectChart: (chart: Chart) => void;
  onOpenDashboard: (chart: Chart) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <aside aria-label="小云业务结果" data-astryx-theme="neutral"
      className="fixed left-3 right-3 top-16 z-[2500] max-h-[48svh] overflow-auto rounded-xl text-slate-900 shadow-xl scheme-light sm:left-auto sm:right-20 sm:top-20 sm:w-[28rem]">
      <Card padding={3}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">小云 · 业务结果</h2>
          <Button label={open ? "收起" : "展开"} size="sm" variant="secondary" aria-expanded={open}
            onClick={() => setOpen((value) => !value)} />
        </div>
        {open && <div className="mt-2 space-y-3">
          {results.toReversed().map(result => result.kind === "chart" ? (
            <section key={result.chartId} className="border-t border-slate-200 pt-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{result.title}</h3>
                <Button size="sm" variant="secondary" aria-pressed={selectedChartId === result.chartId}
                  label={selectedChartId === result.chartId ? "已选中" : "选中追问"} onClick={() => onSelectChart(result)} />
              </div>
              {result.dashboard && <Button size="sm" variant="secondary" label="打开看板" onClick={() => onOpenDashboard(result)} />}
              <ChartPreview chart={result} />
            </section>
          ) : (
            <section key={result.jobId} className="border-t border-slate-200 pt-2">
              <h3 className="text-sm font-medium">分析预测 · {topics[result.topic]}</h3>
              <AnalysisProgress task={result} loadAnalysis={loadAnalysis} />
            </section>
          ))}
        </div>}
      </Card>
    </aside>
  );
}
