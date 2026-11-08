"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceAssistant } from "@xiaoyun/voice";
import type { Topic } from "@/lib/data-agent/contracts";
import {
  analysisJobSchema, xiaoyunContextSchema, type XiaoyunBusinessResult, type XiaoyunContext, type XiaoyunReply,
} from "@/lib/xiaoyun/contracts";
import { XiaoyunBusinessCard } from "./XiaoyunBusinessCard";

const storageKey = "og-xiaoyun-context";

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
  const page = useRef({ topic, onMapCommand });
  const token = useRef("");
  const [requiresToken, setRequiresToken] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [business, setBusiness] = useState<{ id: number; result: XiaoyunBusinessResult }>();

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

    void import("@xiaoyun/voice").then(({ createVoiceAssistant }) => {
      if (disposed || !container.current) return;
      voice.current = createVoiceAssistant({
        container: container.current,
        projectId: "opengridworks",
        mode: "live",
        assetBaseUrl: "/",
        context: { topic: page.current.topic },
        ui: { theme: "power-earth", position: { right: 18, bottom: 90 } },
        browserAdapter: {
          async submit(message, snapshot, signal) {
            signal.throwIfAborted();
            const commandResult = page.current.onMapCommand(message);
            if (commandResult) return { summary: commandResult };

            const response = await fetch("/api/xiaoyun", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
              },
              body: JSON.stringify({ message, topic: snapshot.topic ?? page.current.topic, context: context.current }),
              signal,
            });
            const reply: XiaoyunReply & { error?: string } = await response.json();
            signal.throwIfAborted();
            if (!response.ok) {
              if (response.status === 401) setRequiresToken(true);
              throw new Error(reply.error ?? "小云暂时无法处理此请求。");
            }

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
            const result = reply.business;
            if (result) setBusiness((current) => ({ id: (current?.id ?? 0) + 1, result }));
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
      {business && <XiaoyunBusinessCard key={business.id} result={business.result} loadAnalysis={loadAnalysis} />}
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
