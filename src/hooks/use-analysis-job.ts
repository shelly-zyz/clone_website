"use client";

import { useEffect, useState } from "react";
import type { z } from "zod";
import type { analysisJobSchema, XiaoyunAnalysisArtifact } from "@/lib/xiaoyun/contracts";

export type AnalysisJob = z.infer<typeof analysisJobSchema>;
export type LoadAnalysis = (task: XiaoyunAnalysisArtifact, signal: AbortSignal) => Promise<AnalysisJob>;

export function useAnalysisJob(task: XiaoyunAnalysisArtifact, loadAnalysis: LoadAnalysis) {
  const [job, setJob] = useState<AnalysisJob>();
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const deadline = Date.now() + 400_000;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
        const next = await loadAnalysis(task, signal);
        if (controller.signal.aborted) return;
        setJob(next);
        setNotice("");
        if (next.status === "succeeded" || next.status === "failed") return;
        if (Date.now() < deadline) timer = setTimeout(poll, 2500);
        else setNotice("任务仍在等待，稍后可刷新状态。");
      } catch {
        if (!controller.signal.aborted) setNotice("读取任务状态失败，可手动刷新。");
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [task, loadAnalysis, refresh]);

  return { job, notice, retry: () => { setNotice(""); setRefresh((value) => value + 1); } };
}
