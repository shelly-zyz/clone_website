"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceAssistant } from "@xiaoyun/voice";
import { topicSchema, type Topic } from "@/lib/data-agent/contracts";
import {
  analysisJobSchema, xiaoyunContextSchema, type XiaoyunBusinessResult, type XiaoyunContext, type XiaoyunReply,
} from "@/lib/xiaoyun/contracts";
import { XiaoyunBusinessCard } from "./XiaoyunBusinessCard";

const storageKey = "og-xiaoyun-context";

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
  const page = useRef({ topic, onMapCommand });
  const token = useRef("");
  const [requiresToken, setRequiresToken] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [business, setBusiness] = useState<XiaoyunBusinessResult[]>([]);
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

  useEffect(() => {
    page.current = { topic, onMapCommand };
    voice.current?.updateContext({ topic });
  }, [topic, onMapCommand]);

  useEffect(() => {
    let disposed = false;
    context.current = loadContext();

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
        ui: { theme: "power-earth", position: { right: 18, bottom: 90 } },
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
            const chart = selectedChart.current;
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
            if (results.length) setBusiness(current => {
              const next = current.filter(item => !results.some(result => result.topic === item.topic && (
                result.kind === "analysis" && item.kind === "analysis" && result.jobId === item.jobId
                || result.kind === "chart" && item.kind === "chart" && result.chartId === item.chartId)));
              return [...next, ...results].slice(-4);
            });
            if (results.length && selectedChart.current) {
              selectedChart.current = undefined;
              setSelectedChartId(undefined);
            }
            return { summary: reply.summary, markdown: reply.markdown, data: reply.data, sources: reply.sources };
          },
        },
      });
    }).catch(() => {
      if (!disposed) setLoadError(true);
    });

    return () => {
      disposed = true;
      voice.current?.destroy();
      voice.current = null;
    };
  }, []);

  return (
    <>
      <div ref={container} />
      {business.length > 0 && <XiaoyunBusinessCard results={business} loadAnalysis={loadAnalysis} selectedChartId={selectedChartId}
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
