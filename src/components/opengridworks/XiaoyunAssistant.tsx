"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceAssistant } from "@xiaoyun/voice";
import { topicSchema, type Topic } from "@/lib/data-agent/contracts";
import { forecastOverviewSchema } from "@/lib/globe-forecast";
import {
  analysisJobSchema, xiaoyunAnalysisArtifactSchema, xiaoyunContextSchema,
  type XiaoyunAnalysisArtifact, type XiaoyunBusinessResult, type XiaoyunContext, type XiaoyunReply,
} from "@/lib/xiaoyun/contracts";
import { WorkspaceForecast, type LoadForecastOverview } from "./WorkspaceForecast";
import { XiaoyunBusinessCard, XiaoyunDashboardDialog } from "./XiaoyunBusinessCard";

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

export function XiaoyunAssistant({ topic, onMapCommand }: {
  topic: Topic;
  onMapCommand: (message: string) => string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const voice = useRef<VoiceAssistant | null>(null);
  const context = useRef<XiaoyunContext>({});
  const selectedChart = useRef<{ topic: Topic; chart_id: string } | undefined>(undefined);
  const retry = useRef<{ id: string; message: string; topic: Topic; chartId?: string } | undefined>(undefined);
  const forecastRequest = useRef<{ topic: Topic; message: string; answered: boolean } | null>(null);
  const forecastRefs = useRef<Forecasts>({});
  const page = useRef({ topic, onMapCommand });
  const token = useRef("");
  const [requiresToken, setRequiresToken] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);
  const [business, setBusiness] = useState<XiaoyunBusinessResult[]>([]);
  const [openDashboard, setOpenDashboard] = useState<Extract<XiaoyunBusinessResult, { kind: "chart" }>>();
  const [forecasts, setForecasts] = useState<Forecasts>({});
  const [pendingForecast, setPendingForecast] = useState<Topic>();
  const [forecastNotice, setForecastNotice] = useState<{ topic: Topic; message: string }>();
  const [selectedChartId, setSelectedChartId] = useState<string>();

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
    if (!response.ok) throw new Error("预测数据暂不可用。");
    return forecastOverviewSchema.parse(await response.json());
  }, []);

  function runForecast(message: string) {
    const assistant = voice.current;
    if (!assistant || forecastRequest.current) return;
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

  useEffect(() => {
    page.current = { topic, onMapCommand };
    voice.current?.updateContext({ topic });
  }, [topic, onMapCommand]);

  useEffect(() => {
    let disposed = false;
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
    const capability = fetch("/api/xiaoyun/voice", { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<{ enabled?: boolean }> : null)
      .catch(() => null);

    void Promise.all([import("@xiaoyun/voice"), capability]).then(([{ createVoiceAssistant }, config]) => {
      if (disposed || !container.current) return;
      voice.current = createVoiceAssistant({
        container: container.current,
        projectId: "opengridworks",
        mode: "live",
        assetBaseUrl: "/xiaoyun-audio/",
        context: { topic: page.current.topic },
        ui: { theme: "power-earth", position: { right: 18, bottom: 112 } },
        browserAdapter: {
          audio: config?.enabled ? {
            async transcribe(pcm, signal) { return (await voiceRequest("transcribe", pcm, signal)).text ?? ""; },
            async synthesize(text, signal) {
              const audio = (await voiceRequest("synthesize", JSON.stringify({ text: text.slice(0, 500) }), signal)).audio;
              if (!audio) throw new Error("千问未返回播报音频。");
              return audio;
            },
          } : undefined,
          async submit(message, snapshot, signal) {
            signal.throwIfAborted();
            const commandResult = page.current.onMapCommand(message);
            if (commandResult) return { summary: commandResult };

            const activeTopic = topicSchema.safeParse(snapshot.topic).data ?? page.current.topic;
            const pending = forecastRequest.current;
            const fromSidebar = pending?.topic === activeTopic && pending.message === message;
            const chart = fromSidebar ? undefined : selectedChart.current;
            const previous = retry.current;
            const id = previous?.message === message && previous.topic === activeTopic && previous.chartId === chart?.chart_id
              ? previous.id : newRequestId();
            retry.current = { id, message, topic: activeTopic, chartId: chart?.chart_id };
            const response = await fetch("/api/xiaoyun", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
              },
              body: JSON.stringify({ requestId: id, message, topic: activeTopic, context: context.current, selectedChart: chart }),
              signal,
            });
            const reply: XiaoyunReply & { error?: string } = await response.json();
            signal.throwIfAborted();
            if (!response.ok) {
              if (response.status === 401) setRequiresToken(true);
              if (fromSidebar) {
                pending.answered = true;
                setForecastNotice({ topic: activeTopic, message: reply.error ?? "暂时无法提交预测。" });
              }
              throw new Error(reply.error ?? "小云暂时无法处理此请求。");
            }
            retry.current = undefined;

            const updated = { ...context.current };
            if (reply.threadId) updated.threadId = reply.threadId;
            if (reply.session) updated.sessions = { ...updated.sessions, [reply.session.topic]: reply.session.scope };
            if (reply.lastTopic) updated.lastTopic = reply.lastTopic;
            if (reply.lastRoute) updated.lastRoute = reply.lastRoute;
            context.current = updated;
            try { sessionStorage.setItem(storageKey, JSON.stringify(updated)); } catch {
              // Keep the live session available if browser storage is disabled.
            }
            setRequiresToken(false);
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
            const floatingResults = results.filter(result => !isWorkspaceForecast(result) || result.topic !== page.current.topic);
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
            return { summary: reply.summary, markdown: reply.markdown, data: reply.data, sources: reply.sources };
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
    };
  }, []);

  const visibleBusiness = business.filter(result => !isWorkspaceForecast(result) || result.topic !== topic);
  return (
    <>
      <div ref={container} />
      <WorkspaceForecast key={topic} topic={topic === "meteo" ? "weather" : topic}
        loadOverview={loadForecastOverview} loadAnalysis={loadAnalysis} task={forecasts[topic]}
        ready={ready} pending={pendingForecast !== undefined} onRun={runForecast}
        notice={forecastNotice?.topic === topic ? forecastNotice.message : undefined} />
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
            className="w-32 rounded border border-slate-500 bg-slate-900 px-2 py-1" />
        </label>
      )}
      {loadError && (
        <p role="alert" className="fixed bottom-4 right-4 z-[3000] rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100">
          小云加载失败，请刷新页面重试。
        </p>
      )}
    </>
  );
}
