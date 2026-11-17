"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { VoiceAssistant } from "@xiaoyun/voice";
import type { Topic } from "@/lib/data-agent/contracts";
import { forecastOverviewSchema } from "@/lib/globe-forecast";
import { analysisTopics, analysisTopicOrder } from "@/lib/topic-analysis/catalog";
import { mechanismSchema, type Mechanism } from "@/lib/xiaoyun/anatomy";
import { detectSiteView, resolveSiteNavigation, siteNavigationSchema, type SiteViewId } from "@/lib/xiaoyun/site-views";
import {
  analysisJobSchema, xiaoyunAnalysisArtifactSchema, xiaoyunContextSchema,
  type XiaoyunAnalysisArtifact, type XiaoyunBusinessResult, type XiaoyunContext, type XiaoyunReply,
} from "@/lib/xiaoyun/contracts";
import { WorkspaceForecast, type LoadForecastOverview } from "./WorkspaceForecast";
import { XiaoyunBusinessCard, XiaoyunDashboardDialog } from "./XiaoyunBusinessCard";
import { evidenceSchema, exportReferenceSchema, type Evidence, type ExportReference } from "@/lib/xiaoyun/assistant-artifacts";
import { pageChangeSchema, pageLocation, readActivePage } from "@/lib/xiaoyun/page-actions";
import { XiaoyunEvidence } from "./XiaoyunEvidence";

const XiaoyunMechanismDialog = dynamic(() => import("./XiaoyunMechanismDialog").then(module => module.XiaoyunMechanismDialog), { ssr: false });

const storageKey = "og-xiaoyun-context";
const forecastStorageKey = "og-xiaoyun-forecasts";
type Forecasts = Partial<Record<Topic, XiaoyunAnalysisArtifact>>;

function isWorkspaceForecast(result: XiaoyunBusinessResult): result is XiaoyunAnalysisArtifact {
  return result.kind === "analysis" && result.operation === "forecast" && result.topic !== "meteo";
}

function loadForecasts(): Forecasts {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(forecastStorageKey) ?? "[]");
    if (!Array.isArray(saved)) return {};
    const forecasts: Forecasts = {};
    for (const item of saved) {
      const task = xiaoyunAnalysisArtifactSchema.safeParse(item).data;
      if (task && isWorkspaceForecast(task)) forecasts[task.topic] = task;
    }
    return forecasts;
  } catch {
    return {};
  }
}

function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function loadContext(): XiaoyunContext {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
    return xiaoyunContextSchema.safeParse(saved).data ?? {};
  } catch {
    return {};
  }
}

type Workspace = {
  slot: HTMLDivElement;
  topic: Topic;
  captureView: () => void;
};

const WorkspaceRegistration = createContext<(workspace: Workspace | null) => void>(() => {});
type ChartResponse = { summary: string; chart?: Extract<XiaoyunBusinessResult, { kind: "chart" }> };
const ChartRequest = createContext<((message: string) => Promise<ChartResponse>) | null>(null);

export function useXiaoyunChartRequest() {
  return useContext(ChartRequest);
}

export function XiaoyunAssistant({ topic, captureView }: Pick<Workspace, "topic" | "captureView">) {
  const register = useContext(WorkspaceRegistration);
  const slot = useRef<HTMLDivElement>(null);
  const capture = useRef(captureView);
  useLayoutEffect(() => { capture.current = captureView; }, [captureView]);
  useLayoutEffect(() => {
    if (!slot.current) return;
    register({ slot: slot.current, topic, captureView: () => capture.current() });
    return () => register(null);
  }, [register, topic]);
  return <div ref={slot} />;
}

export function XiaoyunSiteAssistant({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  return (
    <WorkspaceRegistration value={setWorkspace}>
      <XiaoyunRuntime workspace={workspace}>{children}</XiaoyunRuntime>
    </WorkspaceRegistration>
  );
}

function viewTopic(view: SiteViewId | undefined): Topic | undefined {
  if (view === "weather-replay" || view === "globe-weather") return "meteo";
  if (view === "globe-carbon") return "carbon";
  if (view === "globe-power") return "power";
  const analysis = analysisTopicOrder.find(topic => topic === view || "custom-" + topic === view);
  const topic = analysis && analysisTopics[analysis].globe;
  return topic === "weather" ? "meteo" : topic === "economy" ? undefined : topic;
}

function readCurrentPage() {
  const { pathname, search, hash } = window.location;
  const loadedVersion = document.querySelector<HTMLElement>("#topic-analysis-page [data-published-version]")?.dataset.publishedVersion;
  const query = new URLSearchParams(search);
  if (loadedVersion && !query.has("version")) query.set("version", loadedVersion);
  const active = readActivePage(pathname, query.size ? "?" + query : "", hash);
  const location = active && pageLocation(active);
  return active && location ? { ...active, search: location.url.search, section: location.url.hash.slice(1) || undefined } : undefined;
}

function XiaoyunRuntime({ workspace, children }: { workspace: Workspace | null; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const voice = useRef<VoiceAssistant | null>(null);
  const context = useRef<XiaoyunContext>({});
  const selectedChart = useRef<{ topic: Topic; chart_id: string } | undefined>(undefined);
  const retry = useRef<{ id: string; message: string; topic: Topic; view?: SiteViewId; chartId?: string } | undefined>(undefined);
  const forecastRequest = useRef<{ topic: Topic; message: string; answered: boolean } | null>(null);
  const chartRequest = useRef<{ message: string; response?: ChartResponse } | null>(null);
  const forecastRefs = useRef<Forecasts>({});
  const page = useRef({ workspace, router });
  const token = useRef("");
  const [requiresToken, setRequiresToken] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const connectionCheck = useRef<AbortController | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [business, setBusiness] = useState<XiaoyunBusinessResult[]>([]);
  const [openDashboard, setOpenDashboard] = useState<Extract<XiaoyunBusinessResult, { kind: "chart" }>>();
  const [mechanism, setMechanism] = useState<Mechanism>();
  const [mechanismOpen, setMechanismOpen] = useState(false);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [activeEvidence, setActiveEvidence] = useState<Evidence>();
  const [forecasts, setForecasts] = useState<Forecasts>({});
  const [pendingForecast, setPendingForecast] = useState<Topic>();
  const [forecastNotice, setForecastNotice] = useState<{ topic: Topic; message: string }>();
  const [selectedChartId, setSelectedChartId] = useState<string>();
  const workspaceTopic = workspace?.topic;

  const checkConnection = useCallback(async () => {
    connectionCheck.current?.abort();
    const check = new AbortController();
    connectionCheck.current = check;
    try {
      const response = await fetch("/api/xiaoyun/status", {
        method: "POST",
        headers: token.current ? { Authorization: `Bearer ${token.current}` } : {},
        cache: "no-store",
        signal: AbortSignal.any([check.signal, AbortSignal.timeout(18_000)]),
      });
      if (check.signal.aborted) return;
      if (response.status === 401) {
        setRequiresToken(true);
        return;
      }
      if (!response.ok) throw new Error("小云的连接检查失败。");
      const status: {
        database: boolean; dataAgent: boolean; sessions: boolean; modelConfigured: boolean; voiceConfigured: boolean;
      } = await response.json();
      if (check.signal.aborted) return;
      const unavailable = [
        !status.database && "数据库",
        !status.dataAgent && "数据库 Agent",
        !(status.sessions && status.modelConfigured) && "小云问答",
        !status.voiceConfigured && "小云语音",
      ].filter(Boolean);
      setRequiresToken(false);
      setConnectionError(unavailable.length ? `${unavailable.join("、")}暂不可用` : "");
    } catch {
      if (!check.signal.aborted) setConnectionError("小云的连接检查失败");
    }
  }, []);

  useEffect(() => {
    const check = () => { void checkConnection(); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) onVisible(); };
    check();
    window.addEventListener("online", check);
    window.addEventListener("pageshow", onRestore);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      connectionCheck.current?.abort();
      window.removeEventListener("online", check);
      window.removeEventListener("pageshow", onRestore);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkConnection]);

  useEffect(() => {
    if (!connectionError || requiresToken) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkConnection();
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [checkConnection, connectionError, requiresToken]);

  const loadAnalysis = useCallback(async (task: Extract<XiaoyunBusinessResult, { kind: "analysis" }>, signal: AbortSignal) => {
    const scope = context.current.sessions?.[task.topic];
    if (scope?.project_id !== task.projectId) throw new Error("此任务已不在当前小云会话中。");
    const response = await fetch("/api/analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Data-Project-Key": scope.project_key,
        ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
      },
      body: JSON.stringify({ action: "get_job", project_id: task.projectId, job_id: task.jobId }),
      signal,
    });
    if (response.status === 401) setRequiresToken(true);
    if (!response.ok) throw new Error("暂时无法读取任务状态。");
    return analysisJobSchema.parse(await response.json());
  }, []);

  const loadForecastOverview = useCallback<LoadForecastOverview>(async (forecastTopic, signal) => {
    const response = await fetch("/api/xiaoyun/forecast-overview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
      },
      body: JSON.stringify({ topic: forecastTopic }),
      signal,
    });
    if (response.status === 401) throw new Error("请从已授权的业务预览读取预测数据。");
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "预测数据暂不可用。";
      throw new Error(message);
    }
    return forecastOverviewSchema.parse(payload);
  }, []);

  async function download(reference: ExportReference, signal: AbortSignal) {
    const scope = context.current.sessions?.[reference.topic];
    if (!scope) throw new Error("此结果已不在当前项目里。");
    const response = await fetch("/api/xiaoyun/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Data-Project-Key": scope.project_key,
        ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
      },
      body: JSON.stringify({ ...reference, projectId: scope.project_id }), signal,
    });
    if (response.status === 401) setRequiresToken(true);
    if (!response.ok) throw new Error("暂时无法下载此项目结果。");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `opengridworks-${reference.id}.${reference.format}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function runForecast(message: string) {
    const assistant = voice.current;
    const topic = workspaceTopic;
    if (!assistant || !topic || forecastRequest.current) return;
    const request = { topic, message, answered: false };
    forecastRequest.current = request;
    setPendingForecast(topic);
    setForecastNotice(undefined);
    assistant.updateContext({ topic });
    void assistant.submitText(message).catch(() => {}).finally(() => {
      if (forecastRequest.current !== request) return;
      forecastRequest.current = null;
      setPendingForecast(undefined);
      if (!request.answered) setForecastNotice({ topic, message: "预测尚未提交，请重试。" });
    });
  }

  const runCustomChart = useCallback(async (message: string): Promise<ChartResponse> => {
    const assistant = voice.current;
    if (!assistant) return { summary: "小云正在初始化，请稍后再试。" };
    const pending: NonNullable<typeof chartRequest.current> = { message };
    chartRequest.current = pending;
    try {
      await assistant.submitText(message);
      return pending.response ?? { summary: "制图请求未完成，请重试。" };
    } finally {
      if (chartRequest.current === pending) chartRequest.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    page.current = { workspace, router };
    const slot = workspace?.slot ?? container.current;
    if (slot && mount.current && mount.current.parentElement !== slot) slot.appendChild(mount.current);
    const active = detectSiteView(pathname, window.location.search);
    voice.current?.updateContext({ topic: viewTopic(active) ?? context.current.lastTopic ?? "power" });
  }, [pathname, router, workspace]);

  useEffect(() => {
    let disposed = false;
    const voiceMount = document.createElement("div");
    voiceMount.className = "og-assistant-mount";
    (page.current.workspace?.slot ?? container.current)?.appendChild(voiceMount);
    mount.current = voiceMount;
    context.current = loadContext();
    forecastRefs.current = loadForecasts();
    void Promise.resolve().then(() => {
      if (!disposed) setForecasts(forecastRefs.current);
    });

    async function voiceRequest(action: "transcribe" | "synthesize", body: ArrayBuffer | string, signal: AbortSignal) {
      const response = await fetch(`/api/xiaoyun/voice?action=${action}`, {
        method: "POST",
        headers: {
          "Content-Type": action === "transcribe" ? "application/octet-stream" : "application/json",
          ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
        },
        body, signal,
      });
      if (response.status === 401) setRequiresToken(true);
      const payload: { audio?: string; text?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "千问语音暂时不可用。");
      return payload;
    }
    void import("@xiaoyun/voice").then(({ createVoiceAssistant }) => {
      if (disposed) return;
      const active = detectSiteView(window.location.pathname, window.location.search);
      voice.current = createVoiceAssistant({
        container: voiceMount,
        projectId: "opengridworks",
        mode: "live",
        assetBaseUrl: "/xiaoyun-audio/",
        context: { topic: viewTopic(active) ?? context.current.lastTopic ?? "power" },
        ui: { theme: "power-earth", position: { right: 18, bottom: 112 } },
        browserAdapter: {
          audio: {
            async transcribe(pcm, signal) { return (await voiceRequest("transcribe", pcm, signal)).text ?? ""; },
            async synthesize(text, signal) {
              const audio = (await voiceRequest("synthesize", JSON.stringify({ text: text.slice(0, 500) }), signal)).audio;
              if (!audio) throw new Error("千问未返回播报音频。");
              return audio;
            },
          },
          async submit(message, _snapshot, signal) {
            signal.throwIfAborted();
            const { location } = window;
            if (location.pathname === "/workspace" && page.current.workspace?.slot.isConnected) {
              page.current.workspace.captureView();
            }
            const activePage = readCurrentPage();
            const activeView = activePage?.view;
            const activeTopic = viewTopic(activeView) ?? context.current.lastTopic ?? "power";
            const pending = forecastRequest.current;
            const fromSidebar = pending?.topic === activeTopic && pending.message === message;
            const studio = chartRequest.current?.message === message && activeView?.startsWith("custom-") ? chartRequest.current : null;
            const chart = fromSidebar ? undefined : selectedChart.current;
            const previous = retry.current;
            const id = previous?.message === message && previous.topic === activeTopic && previous.view === activeView && previous.chartId === chart?.chart_id
              ? previous.id : newRequestId();
            retry.current = { id, message, topic: activeTopic, view: activeView, chartId: chart?.chart_id };
            const response = await fetch("/api/xiaoyun", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
              },
              body: JSON.stringify({ requestId: id, message, topic: activeTopic, activeView, activePage, context: context.current, selectedChart: chart }),
              signal,
            });
            const reply: XiaoyunReply & { error?: string } = await response.json();
            signal.throwIfAborted();
            if (!response.ok) {
              if (response.status === 401) setRequiresToken(true);
              if (studio) studio.response = { summary: reply.error ?? "暂时无法提交制图。" };
              if (fromSidebar) {
                pending.answered = true;
                setForecastNotice({ topic: activeTopic, message: reply.error ?? "暂时无法提交预测。" });
              }
              throw new Error(reply.error ?? "小云暂时无法处理此请求。");
            }
            retry.current = undefined;

            const retrieved = reply.evidence?.flatMap(item => {
              const parsed = evidenceSchema.safeParse(item).data;
              return parsed ? [parsed] : [];
            });
            if (retrieved) setEvidence(retrieved);
            const opened = evidenceSchema.safeParse(reply.openedEvidence).data;
            if (opened) setActiveEvidence(opened);
            const updated = { ...context.current };
            if (retrieved) updated.evidenceIds = retrieved.map(item => item.id);
            if (reply.threadId) updated.threadId = reply.threadId;
            if (reply.session) updated.sessions = { ...updated.sessions, [reply.session.topic]: reply.session.scope };
            if (reply.lastTopic) updated.lastTopic = reply.lastTopic;
            if (reply.lastRoute) updated.lastRoute = reply.lastRoute;
            context.current = updated;
            try { sessionStorage.setItem(storageKey, JSON.stringify(updated)); } catch {
              // Keep the live session available if browser storage is disabled.
            }
            setRequiresToken(false);
            if (reply.mechanism) {
              const result = mechanismSchema.safeParse(reply.mechanism).data;
              if (result) {
                setMechanism(result);
                setMechanismOpen(true);
              }
            }
            const results = reply.artifacts ?? (reply.business ? [reply.business] : []);
            const dashboard = results.find(result => result.kind === "chart" && result.dashboard);
            if (dashboard?.kind === "chart") setOpenDashboard(dashboard);
            const sidebarResults = results.filter(isWorkspaceForecast);
            if (sidebarResults.length) {
              const next = { ...forecastRefs.current };
              for (const task of sidebarResults) next[task.topic] = task;
              forecastRefs.current = next;
              setForecasts(next);
              try { sessionStorage.setItem(forecastStorageKey, JSON.stringify(Object.values(next))); } catch {
                // The forecast remains visible in this tab when storage is disabled.
              }
            }
            if (fromSidebar) {
              pending.answered = true;
              if (!sidebarResults.some(task => task.topic === activeTopic)) {
                setForecastNotice({ topic: activeTopic, message: reply.summary });
              }
            }
            const studioChart = studio ? results.find(result => result.kind === "chart") : undefined;
            const floatingResults = results.filter(result => result !== studioChart && (!isWorkspaceForecast(result) || result.topic !== page.current.workspace?.topic));
            if (floatingResults.length) setBusiness(current => {
              const next = current.filter(item => !floatingResults.some(result => result.topic === item.topic && (
                result.kind === "analysis" && item.kind === "analysis" && result.jobId === item.jobId
                || result.kind === "chart" && item.kind === "chart" && result.chartId === item.chartId)));
              return [...next, ...floatingResults].slice(-4);
            });
            if (results.length && chart && selectedChart.current === chart) {
              selectedChart.current = undefined;
              setSelectedChartId(undefined);
            }
            let summary = reply.summary;
            if (reply.pageChange) {
              const change = pageChangeSchema.safeParse(reply.pageChange).data;
              const target = change && pageLocation(change.page);
              const current = window.location;
              const confirm = readCurrentPage();
              const expected = change?.expected && pageLocation(change.expected)?.href;
              if (change && target && confirm?.view === activeView && (!expected || confirm && pageLocation(confirm)?.href === expected)) {
                const next = new URL(target.href, current.href);
                if (next.pathname === current.pathname) {
                  if (next.href !== current.href) {
                    window.history.pushState(null, "", target.href);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }
                  const observed = readActivePage(current.pathname, current.search, current.hash);
                  summary = summary.replace("正在应用页面设置。", observed && pageLocation(observed)?.href === target.href
                    ? `已应用${change.status}。` : "页面设置暂未生效。");
                } else {
                  page.current.router.push(target.href);
                  const deadline = performance.now() + 3_000;
                  let applied = false;
                  while (!applied && performance.now() < deadline && !signal.aborted) {
                    await new Promise(resolve => window.setTimeout(resolve, 50));
                    const observed = readCurrentPage();
                    applied = Boolean(observed && pageLocation(observed)?.href === target.href);
                  }
                  signal.throwIfAborted();
                  summary = summary.replace("正在应用页面设置。", applied
                    ? `已应用${change.status}。` : `正在打开${change.status}。`);
                }
              } else {
                summary = summary.replace("正在应用页面设置。", "当前页面已有变更，请重试这次设置。");
              }
            }
            if (reply.export) {
              const reference = exportReferenceSchema.safeParse(reply.export).data;
              if (reference) {
                try {
                  await download(reference, signal);
                  summary = summary.replace("正在准备下载。", "已生成文件并发起下载。");
                } catch {
                  signal.throwIfAborted();
                  summary = summary.replace("正在准备下载。", "下载暂不可用，请重试。");
                }
              }
            }
            if (reply.navigation) {
              const action = siteNavigationSchema.safeParse(reply.navigation).data;
              const target = action && resolveSiteNavigation(action);
              const current = window.location;
              if (target && detectSiteView(current.pathname, current.search) === activeView) {
                const next = new URL(target.href, current.href);
                if (next.href === current.href) {
                  summary = summary.replace(`正在打开${target.label}。`, `当前已在${target.label}。`);
                } else {
                  if (next.pathname === current.pathname) {
                    window.history.pushState(null, "", target.href);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  } else {
                    page.current.router.push(target.href);
                  }
                }
              } else {
                summary = target ? `当前页面已变化，未自动打开${target.label}。` : "无法识别要打开的页面。";
              }
            }
            if (studio) studio.response = { summary, chart: studioChart };
            return { summary, markdown: reply.markdown, data: reply.data, sources: reply.sources };
          },
        },
      });
      setReady(true);
    }).catch(() => {
      if (!disposed) setLoadError(true);
    });

    return () => {
      disposed = true;
      forecastRequest.current = null;
      voice.current?.destroy();
      voice.current = null;
      voiceMount.remove();
      mount.current = null;
    };
  }, []);

  const visibleBusiness = business.filter(result => !isWorkspaceForecast(result) || result.topic !== workspaceTopic);
  const workspaceElement = workspace?.slot.parentElement;
  return (
    <ChartRequest value={ready ? runCustomChart : null}>
      {children}
      <div ref={container} className="[&>.og-assistant-mount]:pointer-events-none [&>.og-assistant-mount]:fixed [&>.og-assistant-mount]:inset-0 [&>.og-assistant-mount]:z-30" />
      {workspaceElement && workspaceTopic && workspaceTopic !== "meteo" && createPortal(<WorkspaceForecast key={workspaceTopic}
        topic={workspaceTopic}
        loadOverview={loadForecastOverview} loadAnalysis={loadAnalysis} task={forecasts[workspaceTopic]}
        ready={ready} pending={pendingForecast !== undefined} onRun={runForecast}
        notice={forecastNotice?.topic === workspaceTopic ? forecastNotice.message : undefined} />, workspaceElement)}
      <XiaoyunEvidence items={evidence} active={activeEvidence} onOpen={setActiveEvidence}
        onClose={() => setActiveEvidence(undefined)} onDismiss={() => setEvidence([])} />
      {mechanism && <button type="button"
        className="fixed bottom-5 right-5 z-[2400] rounded-md bg-slate-950 px-3 py-2 text-sm text-white shadow-lg"
        onClick={() => setMechanismOpen(true)}>打开立体示意</button>}
      {mechanism && mechanismOpen && <XiaoyunMechanismDialog mechanism={mechanism} onClose={() => setMechanismOpen(false)} />}
      {openDashboard && <XiaoyunDashboardDialog key={openDashboard.chartId} chart={openDashboard}
        onClose={() => setOpenDashboard(current => current === openDashboard ? undefined : current)} />}
      {visibleBusiness.length > 0 && <XiaoyunBusinessCard results={visibleBusiness} loadAnalysis={loadAnalysis} selectedChartId={selectedChartId}
        onOpenDashboard={setOpenDashboard}
        onSelectChart={chart => {
          const next = selectedChart.current?.chart_id === chart.chartId ? undefined : { topic: chart.topic, chart_id: chart.chartId };
          selectedChart.current = next;
          setSelectedChartId(next?.chart_id);
        }} />}
      {requiresToken && (
        <label className="fixed bottom-4 right-4 z-[3000] flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100">
          小云访问令牌
          <input type="password" autoComplete="off" onChange={(event) => { token.current = event.target.value.trim(); }}
            onBlur={() => { void checkConnection(); }}
            onKeyDown={(event) => { if (event.key === "Enter") void checkConnection(); }}
            className="w-32 rounded border border-slate-500 bg-slate-900 px-2 py-1" />
        </label>
      )}
      {connectionError && !requiresToken && !loadError && (
        <div role="status" className="fixed bottom-4 right-4 z-[3000] flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100">
          <span>{connectionError}</span>
          <button type="button" className="underline" onClick={() => { void checkConnection(); }}>重新连接</button>
        </div>
      )}
      {loadError && (
        <p role="alert" className="fixed bottom-4 right-4 z-[3000] rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100">
          小云加载失败，请刷新页面重试。
        </p>
      )}
    </ChartRequest>
  );
}
