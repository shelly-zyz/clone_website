"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BarChart3, Bot, Database, FileSearch, GitBranch, LoaderCircle, Zap } from "lucide-react";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { init, use as registerCharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { energyExamples, energyTechnologies, isEnergyTechnology, type EnergyResponse, type EnergyTechnology, type EnergyVisualizationSpec } from "@/lib/energy-agent/contracts";

registerCharts([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const modules = [
  { name: "总管", role: "Pi · 请求路由", icon: Bot },
  { name: "数据", role: "Pi · 目录和只读聚合", icon: Database },
  { name: "可视化", role: "MCP · ECharts 配置", icon: BarChart3 },
  { name: "分析", role: "描述统计 · ResultRef", icon: GitBranch },
  { name: "知识", role: "MCP · 口径与出处", icon: FileSearch },
] as const;

const exampleLabels = ["记录数与占比", "容量字段对比", "数据口径问答", "远景天机资料"];
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const panel = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";

function Chart({ spec }: { spec: EnergyVisualizationSpec }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current);
    chart.setOption(spec.option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [spec.option]);
  return <div className="h-80 w-full" ref={element} role="img" aria-label={spec.title} />;
}

export function EnergyWorkbench({ model }: { model: string | null }) {
  const [question, setQuestion] = useState<string>(energyExamples[0]);
  const [technology, setTechnology] = useState<EnergyTechnology | "all">("all");
  const [result, setResult] = useState<EnergyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const resultMode = result ? result.mode === "pi" ? "Pi 实际执行" : "固定工具流程" : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !question.trim()) return;
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/energy-agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, technology }),
      });
      if (!response.ok) {
        const failure: { error?: string } = await response.json();
        throw new Error(failure.error || "能源查询暂时不可用。");
      }
      setResult(await response.json() as EnergyResponse);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "能源查询暂时不可用。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f2f6fa] text-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-9">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-teal-800">
            <ArrowLeft size={16} /> 返回地球地图
          </Link>
          <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900">
            {model ? `Pi 已配置 · ${model}` : "预览 · 固定工具流程"}
          </span>
        </header>

        <section className="mb-7 mt-6 overflow-hidden rounded-3xl bg-[#0d2637] px-6 py-8 text-white sm:px-9 sm:py-11">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-teal-200"><Zap size={16} /> OPENGRIDWORKS / V11</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">能源智能体工作台</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">从同一份能源地图样本查询数据、生成图表、计算统计量和核对来源。模块面板显示本次实际调用的工具。</p>
        </section>

        <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="min-w-0 space-y-5">
            <section className={panel} aria-labelledby="energy-query">
              <h2 id="energy-query" className="text-lg font-semibold">向能源智能体提问</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {energyExamples.map((example, index) => (
                  <button key={example} type="button" disabled={pending} onClick={() => { setQuestion(example); setTechnology("all"); }} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:border-teal-300 hover:bg-teal-50 disabled:opacity-50">{exampleLabels[index]}</button>
                ))}
              </div>
              <form onSubmit={submit} className="mt-4 space-y-3">
                <textarea aria-label="能源问题" maxLength={400} rows={3} disabled={pending} value={question} onChange={(event) => setQuestion(event.target.value)} className="block w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm leading-6 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-600">技术范围
                    <select disabled={pending} value={technology} onChange={(event) => setTechnology(isEnergyTechnology(event.target.value) ? event.target.value : "all")} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900">
                      <option value="all">全部技术</option>
                      {Object.entries(energyTechnologies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </label>
                  <button type="submit" disabled={pending || !question.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[#087d6e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
                    {pending ? <LoaderCircle size={17} className="animate-spin" /> : <Zap size={17} />}{pending ? "执行中" : "运行查询"}
                  </button>
                </div>
              </form>
              {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              {pending && <p role="status" className="mt-4 text-sm text-slate-600">正在运行。工具轨迹将在结果返回后显示。</p>}
            </section>

            {result && (
              <section aria-label="能源查询结果" className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">查询结果</h2><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900">{resultMode}</span></div>
                <p className="mt-3 text-sm leading-6 text-slate-800">{result.answer}</p>
                {result.analysis && (
                  <dl className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-600">样本记录数</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{number.format(result.analysis.totalRecords)}</dd></div>
                    <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-600">容量字段合计 · MW</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{number.format(result.analysis.totalCapacityMw)}</dd></div>
                    <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-600">最多记录的技术 · 占比</dt><dd className="mt-1 text-lg font-semibold">{result.analysis.largestGroup ? `${energyTechnologies[result.analysis.largestGroup]} · ${percent.format(result.analysis.largestShare ?? 0)}` : "—"}</dd></div>
                  </dl>
                )}
                {result.visualization && (
                  <div className="mt-5 rounded-xl border border-slate-200 p-3">
                    <h3 className="px-2 pt-1 text-sm font-semibold">{result.visualization.title}</h3>
                    <Chart spec={result.visualization} />
                  </div>
                )}
                {result.data && result.data.rows.length > 0 && (
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer font-medium text-teal-900">查看查询明细</summary>
                    <table className="mt-2 w-full text-left">
                      <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-2" scope="col">技术</th><th className="p-2" scope="col">记录数</th><th className="p-2" scope="col">容量字段合计（MW）</th></tr></thead>
                      <tbody>{result.data.rows.map((row) => <tr key={row.technology} className="border-b border-slate-100"><td className="p-2">{energyTechnologies[row.technology]}</td><td className="p-2 tabular-nums">{number.format(row.records)}</td><td className="p-2 tabular-nums">{number.format(row.capacityMw)}</td></tr>)}</tbody>
                    </table>
                  </details>
                )}
              </section>
            )}
          </div>

          <aside className="space-y-5">
            <section className={panel} aria-labelledby="energy-modules">
              <h2 id="energy-modules" className="text-lg font-semibold">模块与调用轨迹</h2>
              <ul className="mt-3 divide-y divide-slate-100">
                {modules.map(({ name, role, icon: Icon }) => {
                  const trace = result?.trace.filter((entry) => entry.module === name) ?? [];
                  const status = trace.find((entry) => entry.status !== "ok")?.status ?? trace[0]?.status;
                  const statusLabel = { ok: "已调用", fallback: "备用路径", unavailable: "范围外" } as const;
                  return (
                    <li key={name} className="py-3">
                      <div className="flex items-center gap-2">
                        <Icon size={17} className="text-teal-700" />
                        <strong className="text-sm">{name}</strong>
                        <span className="ml-auto text-xs text-slate-500">{status ? statusLabel[status] : "等待调用"}</span>
                      </div>
                      <p className="ml-6 mt-0.5 text-xs text-slate-600">{role}</p>
                      {trace.length > 0 && (
                        <ul className="ml-6 mt-2 space-y-1 text-xs leading-5 text-slate-700">
                          {trace.map((entry, index) => (
                            <li key={`${entry.tool}-${index}`}>
                              <code className="break-all text-teal-900">{entry.tool}</code>
                              <p>{entry.detail}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {(result?.data || result?.evidence) && (
              <section className={panel} aria-label="数据来源与限制">
                <h2 className="text-lg font-semibold">数据来源与口径</h2>
                {result.data && (
                  <>
                    <p className="mt-2 text-sm font-medium">{result.data.ref.origin === "postgres" ? "PostgreSQL 只读视图" : "仓库地图数据快照"}</p>
                    <p className="mt-1 text-xs text-slate-600">技术范围 · {result.data.ref.technology === "all" ? "全部技术" : energyTechnologies[result.data.ref.technology]}</p>
                    <code className="mt-1 block break-all text-xs text-slate-600">{result.data.ref.version}</code>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                      {result.data.ref.sources.map((source) => <li key={source}>{source}</li>)}
                    </ul>
                    <p className="mt-3 text-xs leading-5 text-slate-600">{result.data.ref.limitation}</p>
                  </>
                )}
                {result.evidence?.map((item) => (
                  <div key={item.id} className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5">
                    <strong>{item.title}</strong>
                    <p className="text-slate-600">{item.explanation}</p>
                    {item.url && <a className="font-medium text-teal-800 underline" href={item.url} target="_blank" rel="noreferrer">查看来源</a>}
                  </div>
                ))}
              </section>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
