"use client";

import { Bookmark, ChevronDown, FlaskConical, Maximize, PanelsTopLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EChartsType } from "echarts";
import { z } from "zod";
import { type WorkspaceTopic } from "@/lib/globe-topics";
import { xiaoyunContextSchema } from "@/lib/xiaoyun/contracts";
import {
  datasetRequestSchema, figurePatchSchema, layouts, projectKeySchema, themes, type ChartKind, type DatasetRequest, type Domain, type FigureEdit,
  type ExportFormat, type FigureRecommendations, type FigureStyle, type GuidedVisualization, type VisualizationJob, type VisualizationResult, type WorkspaceRequest,
} from "@/lib/visualization-agent/research/contracts";
import { ResearchExport, ResearchInspector, type ListedFigure, type SavedFigure } from "./ResearchInspector";
import { ResearchPreview } from "./ResearchPreview";
import { ResearchChartChoices, type ResearchStep } from "./ResearchChartChoices";
import { ResearchDrawioEditor } from "./ResearchDrawioEditor";
import { ResearchSourceFields, type ResearchCatalog } from "./ResearchSourceFields";
import { allProvinceGeneration, chartNames, datasetLabel, initialStructures, interactiveOnly, layoutNames, metricId, promptExamples,
  selectedStructure, structureDataset, themeNames, topicDomain } from "./research-controls";
import styles from "./research.module.css";

type Draft = VisualizationJob["configuration"];
type FigureReply = { saved: SavedFigure; result: VisualizationResult };
const storageKey = "ogw-visualization-workspace-v1";
const credentialSchema = z.object({ project_id: z.uuid(), project_key: projectKeySchema });
type Credentials = z.infer<typeof credentialSchema>;
const legendNames = { top: "顶部", bottom: "底部", right: "右侧", none: "隐藏" } as const;

class RequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

function restoreProject() {
  try { return credentialSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).data; }
  catch { return undefined; }
}

function download(href: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
}

function downloadDrawing(xml: string, name: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
  download(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ResearchChartStudio({ topic }: { topic: WorkspaceTopic }) {
  const [domain, setDomain] = useState<Domain>(topicDomain[topic]);
  const [draft, setDraft] = useState<Draft>(() => ({ domain: topicDomain[topic], datasets: [], mode: "interactive" }));
  const [step, setStep] = useState<ResearchStep>(1);
  const [recommendation, setRecommendation] = useState<FigureRecommendations>();
  const [month, setMonth] = useState("");
  const [yearOverride, setYear] = useState<number>();
  const [dialogue, setDialogue] = useState<{ question: string; reply: string }[]>([]);
  const [drawing, setDrawing] = useState<{ xml: string; reference: string }>();
  const [figure, setFigure] = useState<VisualizationResult>();
  const [saved, setSaved] = useState<SavedFigure>();
  const [library, setLibrary] = useState<ListedFigure[]>();
  const [catalog, setCatalog] = useState<ResearchCatalog>();
  const [prompt, setPrompt] = useState("");
  const [attention, setAttention] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const project = useRef<Credentials | undefined>(undefined);
  const token = useRef("");
  const pending = useRef<AbortController | null>(null);
  const chart = useRef<EChartsType | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const catalogRequest = useRef<AbortController | null>(null);

  const request = useCallback(async (command: WorkspaceRequest, signal: AbortSignal, access?: Credentials) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token.current) headers.set("authorization", "Bearer " + token.current);
    if (access) {
      headers.set("x-data-project-id", access.project_id);
      headers.set("x-data-project-key", access.project_key);
    }
    const response = await fetch("/api/visualization/workspace", { method: "POST", headers, body: JSON.stringify(command), signal, cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw new RequestError(response.status, body.error ?? "无法完成制图请求，请重试。", body.code);
    }
    return response;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    catalogRequest.current = controller;
    void request({ action: "catalog" }, controller.signal).then(async response => {
      if (controller.signal.aborted) return;
      setCatalog(await response.json() as ResearchCatalog);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof RequestError && error.status === 401) setAuthRequired(true);
      else setAttention("暂时无法读取指标目录，请刷新重试。");
    });
    return () => {
      catalogRequest.current?.abort();
      pending.current?.abort();
    };
  }, [request]);

  async function ensureProject(signal: AbortSignal) {
    project.current ??= restoreProject();
    if (project.current) return project.current;
    const created = credentialSchema.parse(await (await request({ action: "start", domain }, signal)).json());
    project.current = created;
    try { localStorage.setItem(storageKey, JSON.stringify(created)); } catch { /* The current page can still use the project. */ }
    return created;
  }

  async function call<T>(command: WorkspaceRequest, signal: AbortSignal, access?: Credentials): Promise<T> {
    const scoped = access ?? await ensureProject(signal);
    return await (await request(command, signal, scoped)).json() as T;
  }

  async function run(label: string, operation: (signal: AbortSignal) => Promise<string>) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setAttention("");
    setStatus(label);
    try {
      const next = await operation(controller.signal);
      if (!controller.signal.aborted) setStatus(next);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof RequestError && error.status === 401) setAuthRequired(true);
        setAttention(error instanceof RequestError ? error.message : "工作区连接或数据参数有误，请核对来源和范围后重试。");
        setStatus("");
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function update(result: VisualizationResult) {
    const nextDomain = result.recipe.domain ?? result.plan.datasets[0]?.domain;
    if (nextDomain) setDomain(nextDomain);
    const structure = selectedStructure(result.recipe, result.plan.chart);
    setDraft({ ...result.recipe, structure, kind: result.plan.chart });
    setRecommendation(current => current && raw(current.datasets.map(item => item.query)) === raw(result.recipe.datasets) &&
      current.choices.some(choice => choice.structure === structure && choice.charts.includes(result.plan.chart)) ? current : {
      datasets: result.plan.datasets, choices: structure ? [{ structure, charts: [result.plan.chart] }] : [],
    });
    const province = result.recipe.datasets.find(item => item.kind === "published" && item.query.topic === "power" && item.query.province_comparison);
    if (province?.kind === "published") setMonth(province.query.start_date?.slice(0, 7) ?? "");
    const capacity = result.recipe.datasets.find(item => item.kind === "annual-capacity");
    if (capacity?.kind === "annual-capacity" && capacity.composition_year) setYear(capacity.composition_year);
    setFigure(result);
    setStep(3);
  }

  function selectTopic(next: Domain) {
    if (domain === next) return;
    setDomain(next);
    setDraft({ domain: next, datasets: [], mode: "interactive" });
    setStep(1);
    setRecommendation(undefined);
    setMonth("");
    setYear(undefined);
    setDialogue([]);
    setFigure(undefined);
    setSaved(undefined);
    setPrompt("");
    setAttention("");
    setStatus("");
  }

  function chooseChart(kind: ChartKind) {
    setDraft(value => {
      const mode = kind === "violin" || kind === "density" ? "paper"
        : interactiveOnly(kind) ? "interactive" : value.mode ?? "interactive";
      const changeMode = mode !== (value.mode ?? "interactive");
      const resetEngine = changeMode || value.engine === "flint" && kind !== "trend" && kind !== "columns";
      return { ...value, domain, kind, mode, engine: resetEngine ? "auto" : value.engine,
        style: changeMode ? { ...value.style, theme: undefined } : value.style };
    });
  }

  function changeDataset(index: number, source: DatasetRequest) {
    setDraft(value => ({ ...value, structure: undefined, kind: undefined, datasets: value.datasets.map((data, i) => i === index ? source : data) }));
    setRecommendation(undefined);
  }

  function chooseData() {
    setStep(1);
    setRecommendation(undefined);
    setAttention("");
  }

  function chooseStructure() {
    const options = initialStructures(draft.datasets);
    if (!options.length || !datasetRequestSchema.array().safeParse(draft.datasets).success) {
      setAttention("请先选择指标，并核对地区和时间范围。");
      return;
    }
    const first = draft.datasets[0];
    if (!month && first.kind === "published") setMonth(first.query.start_date?.slice(0, 7) ?? "");
    setRecommendation(undefined);
    setDraft(value => ({ ...value, structure: value.structure && options.includes(value.structure) ? value.structure :
      options.length === 1 ? options[0] : undefined, kind: undefined }));
    setStep(2);
    setAttention("");
  }

  function showRecommendations() {
    const structure = draft.structure;
    if (!structure || structure === "categories" && allProvinceGeneration(draft.datasets) && !month) return;
    void run("正在核对数据并筛选图样…", async signal => {
      const datasets = structureDataset(draft.datasets, structure, month, year);
      const result = await call<FigureRecommendations>({ action: "recommend", datasets }, signal);
      const choice = result.choices.find(item => item.structure === structure);
      if (!choice) throw new RequestError(422, "这组数据无法生成所选结构，请调整范围或切换数据结构。");
      setRecommendation(result);
      setDraft(value => ({ ...value, datasets: result.datasets.map(item => item.query),
        kind: value.kind && value.kind !== "auto" && choice.charts.includes(value.kind) ? value.kind : undefined }));
      setStep(3);
      return "";
    });
  }

  function setStyle(patch: FigureStyle) {
    setDraft(value => ({ ...value, style: { ...value.style, ...patch } }));
  }

  function submitDraft() {
    if (!canGenerate) return;
    void run("正在校验数据并生成图件…", async signal => {
      const patch = figurePatchSchema.safeParse(draft).data;
      if (!patch?.datasets) throw new RequestError(400, "请检查数据引用、日期与图件参数。");
      const task_id = crypto.randomUUID();
      const command: WorkspaceRequest = figure
        ? { action: "edit", task_id, artifact_id: figure.artifact_id, patch: { ...patch, engine: patch.engine ?? "auto",
          layout: patch.layout ?? "auto", clear: cleared(figure.recipe, patch) } }
        : { action: "render", job: { task_id, configuration: { ...patch, datasets: patch.datasets } } };
      const response = await call<VisualizationResult>(command, signal);
      update(response);
      return "图件已生成";
    });
  }

  function ask() {
    const question = prompt.trim();
    if (!question) return;
    void run("小云正在规划图件…", async signal => {
      const patch = draft.datasets.length ? figurePatchSchema.safeParse(draft).data : undefined;
      try {
        const response = await call<VisualizationResult | GuidedVisualization>({ action: "ask", task_id: crypto.randomUUID(), domain, message: question,
          artifact_id: figure?.artifact_id, draft: patch, guided: true, dialogue }, signal);
        setPrompt("");
        setDialogue([]);
        if ("recommendation" in response) {
          setDomain(response.recipe.domain ?? response.recommendation.datasets[0]?.domain ?? domain);
          const choices = response.recommendation.choices;
          const structure = response.recipe.structure && choices.some(item => item.structure === response.recipe.structure)
            ? response.recipe.structure : choices.length === 1 ? choices[0].structure : undefined;
          setDraft({ ...response.recipe, structure });
          setRecommendation(response.recommendation);
          setStep(structure ? 3 : 2);
          return response.explanation ?? "";
        }
        update(response);
        return figure ? "修改已应用" : "图件已生成";
      } catch (error) {
        if (!(error instanceof RequestError) || error.code !== "CLARIFICATION") throw error;
        setDialogue(turns => [...turns, { question, reply: error.message.slice(0, 180) }].slice(-3));
        setPrompt("");
        return "";
      }
    });
  }

  function save(newFigure = false) {
    if (!figure) return;
    void run("正在保存图件…", async signal => {
      const reply = await call<FigureReply>({ action: "save", artifact_id: figure.artifact_id,
        ...(saved && !newFigure ? { figure_id: saved.figure_id, expected_revision: saved.revision } : {}) }, signal);
      update(reply.result);
      setSaved(reply.saved);
      setLibrary(undefined);
      return "已保存修订 " + reply.saved.revision;
    });
  }

  function open(figure_id: string, revision?: number) {
    void run("正在读取已保存的图件…", async signal => {
      const reply = await call<FigureReply>({ action: "open", figure_id, revision }, signal);
      update(reply.result);
      setSaved(reply.saved);
      return "已打开修订 " + reply.saved.revision;
    });
  }

  function list() {
    if (library) { setLibrary(undefined); return; }
    void run("正在读取图件库…", async signal => {
      const reply = await call<{ figures: ListedFigure[] }>({ action: "list" }, signal);
      setLibrary(reply.figures);
      return "";
    });
  }

  function useXiaoyunProject() {
    void run("正在查找小云的数据项目…", async signal => {
      const context = xiaoyunContextSchema.safeParse(JSON.parse(sessionStorage.getItem("og-xiaoyun-context") ?? "{}")).data;
      const currentTopic = domain === "electricity" ? "power" : domain === "meteorology" ? "meteo" : domain === "economy" ? context?.lastTopic : "carbon";
      const session = currentTopic ? context?.sessions?.[currentTopic] : undefined;
      if (!session) throw new RequestError(404, "当前专题还没有小云问数会话。");
      const access = credentialSchema.parse(session);
      await call({ action: "list" }, signal, access);
      const result = await call<{ result_id: string }>({ action: "session-source", session_id: session.session_id }, signal, access)
        .catch(error => {
          if (error instanceof RequestError && error.status === 422) return undefined;
          throw error;
        });
      project.current = access;
      try { localStorage.setItem(storageKey, JSON.stringify(access)); } catch { /* The current page can still use the project. */ }
      if (result) {
        setDraft({ domain, mode: "interactive", datasets: [{ kind: "result", result_id: result.result_id }] });
        setStep(1);
        setRecommendation(undefined);
      }
      setFigure(undefined);
      setSaved(undefined);
      setLibrary(undefined);
      return result ? "已选择小云最近一次问数结果" : "已打开小云的数据项目";
    });
  }

  function exportFigure(format: ExportFormat) {
    if (!figure) return;
    void run("正在准备下载…", async signal => {
      const stem = "opengridworks-" + figure.artifact_id.slice(0, 8);
      if (format === "png" && figure.render.kind === "echarts") {
        if (!chart.current) throw new RequestError(409, "请等待画布显示后再导出 PNG。");
        download(chart.current.getDataURL({ type: "png", pixelRatio: 2 }), stem + ".png");
      } else {
        const access = await ensureProject(signal);
        const reply = await request({ action: "export", artifact_id: figure.artifact_id, format }, signal, access);
        const url = URL.createObjectURL(await reply.blob());
        download(url, stem + "." + (format === "python" ? "py" : format));
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      return "下载已就绪";
    });
  }

  function openDrawio() {
    if (!figure) return;
    void run("正在生成可编辑图件…", async signal => {
      const access = await ensureProject(signal);
      const response = await request({ action: "export", artifact_id: figure.artifact_id, format: "drawio" }, signal, access);
      setDrawing({ xml: await response.text(), reference: figure.artifact_id.slice(0, 8) });
      return "";
    });
  }
  const saveDrawing = useCallback((xml: string) => {
    downloadDrawing(xml, "opengridworks-" + drawing?.reference + "-edited.drawio");
  }, [drawing?.reference]);
  const onPreviewError = useCallback(() => setAttention("画布加载失败，请重新打开图件。"), []);
  const paper = draft.mode === "paper";
  const engineEnabled = (id: string) => catalog?.engines.find(engine => engine.id === id)?.available;
  const isDirty = Boolean(figure && raw(draft) !== raw({ ...figure.recipe, kind: figure.plan.chart,
    structure: selectedStructure(figure.recipe, figure.plan.chart) }));
  const selectedChart = draft.kind && draft.kind !== "auto" ? draft.kind : undefined;
  const canGenerate = Boolean(step === 3 && selectedChart && recommendation?.choices.some(choice =>
    choice.structure === draft.structure && choice.charts.includes(selectedChart)));
  const allMetrics = catalog?.sources.business_datasets ?? [];
  const metrics = allMetrics.filter(item => item.domain === domain);
  const annual = allMetrics.find(item => item.id === "annual-capacity")?.request;
  const firstCapacityYear = annual?.kind === "annual-capacity" ? annual.start_year ?? 2020 : 2020;
  const lastCapacityYear = annual?.kind === "annual-capacity" ? annual.end_year ?? 2025 : 2025;
  const years = Array.from({ length: lastCapacityYear - firstCapacityYear + 1 }, (_, i) => lastCapacityYear - i);
  const year = yearOverride ?? lastCapacityYear;
  const needMonth = draft.structure === "categories" && allProvinceGeneration(draft.datasets);
  const localEditor = figure?.plan.output.includes("drawio") && typeof window !== "undefined" &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname);

  return <section className={styles.workspace} aria-labelledby="research-title">
    <header className={styles.header}>
      <div className={styles.heading}>
        <div className={styles.mark}><FlaskConical size={20} aria-hidden /></div>
        <div><h2 id="research-title">科研制图工作区</h2><p>在一张画布上对照已发布数据，保存图件与来源版本。</p></div>
      </div>
      <div className={styles.commands}>
        <a className={styles.assistantLink} href="#research-instruction"><Sparkles size={16} aria-hidden />和小云一起制图</a>
        <button type="button" disabled={busy} onClick={list}><Bookmark size={16} aria-hidden />图件库</button>
        <button type="button" className={styles.primary} disabled={busy || !figure} onClick={() => save()}>保存图件</button>
      </div>
    </header>

    {library && <section className={styles.library} aria-label="已保存的图件">
      <h3>项目图件</h3>
      {library.length ? library.map(item => <button type="button" disabled={busy} key={item.figure_id} onClick={() => open(item.figure_id)}>
        <strong>{item.title}</strong><span>修订 {item.revision} · {item.at.slice(0, 10)}</span>
      </button>) : <p>当前项目暂无已保存图件。</p>}
    </section>}

    {authRequired && <form className={styles.auth} onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      token.current = String(data.get("token") ?? "").trim();
      event.currentTarget.reset();
      void run("正在校验业务凭证…", async signal => {
        const reply = await request({ action: "catalog" }, signal);
        setCatalog(await reply.json() as ResearchCatalog);
        setAuthRequired(false);
        return "授权成功，可以继续制图";
      });
    }}>
      <label>业务访问凭证<input name="token" type="password" autoComplete="off" required /></label>
      <button className={styles.primary} type="submit" disabled={busy}>验证</button>
    </form>}

    {(attention || status) && <div className={styles.notice} data-error={Boolean(attention)} role={attention ? "alert" : "status"}>
      {attention || status}
    </div>}
    <ResearchChartChoices domain={domain} draft={draft} step={step} recommendation={recommendation} busy={busy}
      onDomain={selectTopic} onChart={chooseChart} onData={chooseData}
      onStructure={structure => setDraft(value => ({ ...value, structure, kind: undefined }))}
      month={month} year={year} years={years} onMonth={setMonth} onYear={setYear}
      dataInputs={<>
        <div className={styles.metricPicker}>
          <label>数据指标<select value="" disabled={busy || draft.datasets.length >= 6} onChange={event => {
            const selected = allMetrics.find(item => item.id === event.target.value);
            if (selected) setDraft(value => ({ ...value, structure: undefined, kind: undefined, datasets: [...value.datasets, selected.request] }));
            else if (event.target.value === "forecast-job") setDraft(value => ({ ...value, structure: undefined, kind: undefined,
              datasets: [...value.datasets, { kind: "forecast-job", job_id: "" }] }));
            else if (event.target.value === "approved") setDraft(value => ({ ...value, structure: undefined, kind: undefined,
              datasets: [...value.datasets, { kind: "approved", id: "" }] }));
          }}>
            <option value="" disabled>{catalog ? "选择要绘制的指标" : "正在读取指标目录…"}</option>
            {metrics.map(item => <option key={item.id} value={item.id}>{item.label}（{item.unit}）</option>)}
            <option value="forecast-job">我的预测或回测结果</option>
            {catalog?.sources.approved_catalog && <option value="approved">我的审核归档数据</option>}
          </select></label>
          <button type="button" className={styles.textButton} disabled={busy} onClick={useXiaoyunProject}>使用小云已有问数结果</button>
        </div>
        <div className={styles.metricList}>
          {draft.datasets.map((data, index) => <ResearchSourceFields key={index + ":" + metricId(data)} data={data}
            label={datasetLabel(data, allMetrics, figure?.plan.datasets[index])} index={index} catalog={catalog}
            onChange={source => changeDataset(index, source)} onRemove={() =>
              setDraft(value => ({ ...value, structure: undefined, kind: undefined, datasets: value.datasets.filter((_, i) => index !== i) }))} />)}
        </div>
      </>}
      controls={step === 1 ? <button className={styles.primary} type="button" disabled={busy || !draft.datasets.length} onClick={chooseStructure}>下一步</button>
        : step === 2 ? <button className={styles.primary} type="button" disabled={busy || !draft.structure || needMonth && !month}
          onClick={showRecommendations}>查看参考图</button>
          : <>
            <button type="button" className={styles.textButton} disabled={busy} onClick={() => {
              setRecommendation(undefined);
              setStep(2);
            }}>返回数据结构</button>
            <button className={styles.primary} type="submit" form="research-figure-configuration" disabled={busy || !canGenerate}>
              {figure ? "应用所选图样" : "生成图件"}
            </button>
          </>} />
    <div className={styles.workspaceGrid}>
      <details className={styles.config} open={step === 3}>
        <summary>绘图设置<ChevronDown size={15} aria-hidden /></summary>
        <form id="research-figure-configuration" onSubmit={event => { event.preventDefault(); submitDraft(); }}>
          <fieldset disabled={busy}>
            <label>绘图模式<select value={paper ? "paper" : "interactive"} onChange={event => {
              const mode = event.target.value as Draft["mode"];
              setDraft(value => ({ ...value, mode, engine: undefined, style: { ...value.style, theme: undefined } }));
            }}>
              <option value="interactive" disabled={selectedChart === "violin" || selectedChart === "density"}>网页交互</option>
              <option value="paper" disabled={engineEnabled("matplotlib") === false || interactiveOnly(selectedChart)}>论文图件</option>
            </select></label>
            <label>引擎<select value={draft.engine ?? "auto"}
              onChange={event => setDraft(value => ({ ...value, engine: event.target.value as Draft["engine"] }))}>
              <option value="auto">自动</option>
              <option value="echarts" disabled={paper}>ECharts</option>
              <option value="flint" disabled={paper || engineEnabled("flint") === false ||
                Boolean(selectedChart && selectedChart !== "trend" && selectedChart !== "columns")}>Flint → ECharts</option>
              <option value="matplotlib" disabled={!paper || engineEnabled("matplotlib") === false}>Matplotlib</option>
            </select></label>
            <details className={styles.details}>
              <summary>主题与排版</summary>
              <div className={styles.design}>
                <label>图名<input value={draft.title ?? ""} placeholder={figure?.viewport.compact_model?.title ?? "根据指标生成"}
                  maxLength={100} onChange={event => setDraft(value => ({ ...value, title: event.target.value || undefined }))} /></label>
                <label>主题<select value={draft.style?.theme ?? ""}
                  onChange={event => setStyle({ theme: (event.target.value || undefined) as FigureStyle["theme"], accent: undefined })}>
                  <option value="">随绘图模式</option>
                  {themes.filter(theme => !paper || theme.startsWith("academic-")).map(theme => <option key={theme} value={theme}>{themeNames[theme]}</option>)}
                </select></label>
                <label>布局<select value={draft.layout ?? "auto"}
                  onChange={event => setDraft(value => ({ ...value, layout: event.target.value as Draft["layout"] }))}>
                  {layouts.map(layout => <option key={layout} value={layout}>{layoutNames[layout]}</option>)}
                </select></label>
                <label>图例<select value={draft.style?.legend ?? "bottom"} onChange={event => setStyle({ legend: event.target.value as FigureStyle["legend"] })}>
                  {Object.entries(legendNames).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select></label>
                <label>字体<select value={draft.style?.font ?? "Arial"} onChange={event => setStyle({ font: event.target.value as FigureStyle["font"] })}>
                  {["Arial", "Microsoft YaHei", "Noto Sans CJK SC", "DejaVu Sans"].map(font => <option key={font}>{font}</option>)}
                </select></label>
                <label>字号<input type="number" min={7} max={18} value={draft.style?.font_size ?? ""} placeholder={paper ? "8" : "11"}
                  onChange={event => setStyle({ font_size: event.target.value ? Number(event.target.value) : undefined })} /></label>
                <label className={styles.check}><input type="checkbox" checked={Boolean(draft.style?.accent)}
                  onChange={event => setStyle({ accent: event.target.checked ? "#165b55" : undefined })} /> 自定义强调色</label>
                {draft.style?.accent && <label>强调色<input type="color" value={draft.style.accent}
                  onChange={event => setStyle({ accent: event.target.value })} /></label>}
                <div className={styles.pair}>
                  <label>宽（mm）<input type="number" min={70} max={245} value={draft.style?.width_mm ?? ""} placeholder="183"
                    onChange={event => setStyle({ width_mm: event.target.value ? Number(event.target.value) : undefined })} /></label>
                  <label>高（mm）<input type="number" min={48} max={230} value={draft.style?.height_mm ?? ""} placeholder={paper ? "114" : "132"}
                    onChange={event => setStyle({ height_mm: event.target.value ? Number(event.target.value) : undefined })} /></label>
                </div>
              </div>
            </details>
            <button className={styles.primary} type="submit" disabled={busy || !canGenerate}>{figure ? "应用到图件" : "生成图件"}</button>
          </fieldset>
        </form>
      </details>

      <div className={styles.center}>
        <div className={styles.canvas} ref={frame}>
          <header className={styles.canvasHeader}>
            <div><h3>{figure?.recipe.title ?? "图件画布"}</h3>
              <p>{figure ? chartNames[figure.plan.chart] + " · " + figure.plan.engine + (figure.engine_version ? " " + figure.engine_version : "")
                : "选择指标和范围后，结果将在这里显示。"}</p>
            </div>
            {figure && <button className={styles.iconButton} type="button" title="全屏查看" aria-label="全屏查看" onClick={() => {
              const canvas = frame.current;
              if (!canvas) return;
              if (document.fullscreenElement === canvas) void document.exitFullscreen();
              else void canvas.requestFullscreen().catch(() => setAttention("此浏览器暂不支持全屏画布。"));
            }}><Maximize size={17} aria-hidden /></button>}
          </header>
          {figure ? <ResearchPreview onError={onPreviewError} chart={chart} figure={figure} />
            : <div className={styles.empty}>
              <span><PanelsTopLeft size={30} strokeWidth={1.5} aria-hidden /></span>
              <strong>{selectedChart ? chartNames[selectedChart] : "选择一种图样"}</strong>
              <p>{selectedChart ? "将按已核对的指标和时间生成。" : "也可以在小云制图中描述你的研究问题。"}</p>
              <button className={styles.primary} type="button" onClick={submitDraft} disabled={busy || !canGenerate}>生成当前图件</button>
            </div>}
          {figure && <footer className={styles.canvasBar}>
            <ResearchExport figure={figure} busy={busy} onExport={exportFigure} />
            {localEditor && <button type="button" disabled={busy} onClick={openDrawio}>在本机 Draw.io 打开</button>}
            {saved && <label>修订
              <select value={figure.revision ?? ""} onChange={event => open(saved.figure_id, Number(event.target.value))} disabled={busy}>
                {!figure.revision && <option value="" disabled>未保存</option>}
                {saved.revisions.toReversed().map(item => <option key={item.id} value={item.revision}>{item.revision}</option>)}
              </select>
            </label>}
          </footer>}
        </div>
        {figure && isDirty && <p className={styles.hint}>配置有修改，应用后可保存新修订。</p>}
        {figure && saved && <button className={styles.textButton} type="button" disabled={busy} onClick={() => save(true)}>另存为新图件</button>}
      </div>

      <aside className={styles.inspector} aria-label="智能编辑与数据解读">
        <form className={styles.ask} onSubmit={event => { event.preventDefault(); ask(); }}>
          <h3><Sparkles size={16} aria-hidden />小云制图</h3>
          {dialogue.length > 0 && <div className={styles.dialogue} aria-live="polite">{dialogue.map((turn, index) => <div key={index}>
            <p>{turn.question}</p><strong>{turn.reply}</strong>
          </div>)}</div>}
          <label htmlFor="research-instruction">{dialogue.length ? "回答小云" : figure ? "修改当前图件" : "描述研究问题"}</label>
          <textarea id="research-instruction" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={500}
            rows={3} placeholder={figure ? "比如：换成学术黑白" : promptExamples[domain]} disabled={busy} />
          <div className={styles.askActions}>
            <button type="button" className={styles.textButton} disabled={busy} onClick={() => setPrompt(figure ? "换成学术黑白" : promptExamples[domain])}>填入示例</button>
            <button type="submit" className={styles.primary} disabled={busy || !prompt.trim()}>{figure ? "提交修改" : "让小云制图"}</button>
          </div>
        </form>
        <ResearchInspector figure={figure} saved={saved} />
      </aside>
    </div>
    {drawing && <ResearchDrawioEditor drawing={drawing.xml} onClose={() => setDrawing(undefined)} onSave={saveDrawing} />}
  </section>;
}

function raw(value: unknown) { return JSON.stringify(value); }

function cleared(previous: Draft, next: FigureEdit): NonNullable<FigureEdit["clear"]> {
  const fields = (["theme", "accent", "font_size", "width_mm", "height_mm"] as const)
    .filter(field => previous.style?.[field] !== undefined && next.style?.[field] === undefined);
  return previous.title && !next.title ? ["title", ...fields] : fields;
}
