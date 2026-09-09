"use client";

import { Activity, ChevronDown, Database, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type QueueProgress = {
  key: "A" | "B";
  label: string;
  completedFiles: number;
  totalFiles: number;
  progressPercent: number;
  phase: string;
  phasePercent: number;
  current: {
    fileName: string;
    variable: string;
    variableLabel: string;
    importedFrames: number;
    expectedDays: number;
    localBytes: number;
    expectedSizeBytes: number;
  } | null;
};

type ImportProgress = {
  ok: true;
  status: "running" | "completed";
  progressPercent: number;
  completedFiles: number;
  totalFiles: number;
  importedFrames: number;
  expectedFrames: number;
  database: {
    bytes: number;
    formatted: string;
  };
  queues: QueueProgress[];
  updatedAt: string;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function ImportProgressIndicator() {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/data/import-progress", { cache: "no-store" });
      const payload = await response.json() as ImportProgress | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error("error" in payload ? payload.error : "进度请求失败");
      }
      setProgress(payload);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "进度请求失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section className={`og-import-progress ${expanded ? "is-expanded" : ""}`} aria-label="气候数据导入进度">
      <button
        type="button"
        className="og-import-progress-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`og-import-status-dot ${progress?.status === "completed" ? "is-complete" : ""}`} />
        <span className="og-import-summary-copy">
          <strong>{loading ? "正在读取导入进度" : "气候数据导入"}</strong>
          <small>
            {error
              ? "暂时无法连接数据库"
              : `${progress?.progressPercent ?? 0}% · ${progress?.completedFiles ?? 0}/${progress?.totalFiles ?? 20} 个文件`}
          </small>
        </span>
        <span className="og-import-summary-percent">{progress?.progressPercent ?? 0}%</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <div className="og-import-overall-track" aria-hidden="true">
        <span style={{ width: `${progress?.progressPercent ?? 0}%` }} />
      </div>

      {expanded ? (
        <div className="og-import-progress-detail">
          {error ? (
            <button type="button" className="og-import-retry" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden="true" />
              {error}，点击重试
            </button>
          ) : (
            <>
              <div className="og-import-progress-meta">
                <span><Activity size={13} aria-hidden="true" />双队列并行</span>
                <span><Database size={13} aria-hidden="true" />{progress?.database.formatted ?? "—"}</span>
              </div>
              <div className="og-import-queue-list">
                {(progress?.queues ?? []).map((queue) => (
                  <article className="og-import-queue" key={queue.key}>
                    <header>
                      <strong>{queue.label}</strong>
                      <span>{queue.phase} {queue.phasePercent}%</span>
                    </header>
                    <div className="og-import-queue-track" aria-hidden="true">
                      <span style={{ width: `${queue.phasePercent}%` }} />
                    </div>
                    <p>
                      {queue.current
                        ? `${queue.current.variableLabel} · ${queue.current.importedFrames.toLocaleString("zh-CN")} / ${queue.current.expectedDays.toLocaleString("zh-CN")} 天`
                        : "该队列已全部完成"}
                    </p>
                  </article>
                ))}
              </div>
              <footer>
                <span>{progress?.importedFrames.toLocaleString("zh-CN") ?? 0} / {progress?.expectedFrames.toLocaleString("zh-CN") ?? 0} 日帧</span>
                <button type="button" onClick={() => void refresh()} aria-label="立即刷新导入进度">
                  <RefreshCw size={13} aria-hidden="true" />
                  {progress ? formatUpdatedAt(progress.updatedAt) : "刷新"}
                </button>
              </footer>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
