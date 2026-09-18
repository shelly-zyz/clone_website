"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DashboardQueryContext, EnergyExecutionPlan, EnergyIR, EnergyResult } from "@/lib/energy-ir/schema";
import type { VoiceDashboardCommand } from "@/lib/voice/voice-state";

import styles from "./china-dashboard.module.css";

type QueryResponse = {
  status: "answered" | "planned" | "clarification" | "unavailable" | "refused";
  message?: string;
  reasonCode?: string;
  ir?: EnergyIR;
  plan?: EnergyExecutionPlan;
  result?: EnergyResult;
  trace?: { planner?: string | null; model?: string | null; semanticCatalogVersion?: string; tool?: string | null; generatedSql?: boolean; validatedBeforeExplanation?: boolean };
};

type AgentCatalogResponse = {
  semanticCatalogVersion: string;
  agent: { configured: boolean; provider: string; model: string | null; reason?: string };
};

const suggestions = [
  "广东有多少已映射光伏设施",
  "当前GFS数据是什么时间的",
  "OSM图层覆盖全国吗",
];

export function AskEnergyPanel({ context, onClose }: { context: DashboardQueryContext; onClose: () => void; onDashboardCommand: (command: VoiceDashboardCommand) => void }) {
  const [question, setQuestion] = useState(suggestions[0]);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [agent, setAgent] = useState<AgentCatalogResponse | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    fetch("/api/energy-ir/query", { cache: "no-cache" })
      .then((request) => request.json() as Promise<AgentCatalogResponse>)
      .then((payload) => { if (active) setAgent(payload); })
      .catch(() => { if (active) setAgent({ semanticCatalogVersion: "1.0.0", agent: { configured: false, provider: "openai", model: null, reason: "无法读取智能体配置状态。" } }); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    requestSequence.current += 1;
    activeRequest.current?.abort();
  }, []);

  const submitQuestion = useCallback(async (nextQuestion: string) => {
    const normalizedQuestion = nextQuestion.trim();
    if (!normalizedQuestion || !agent?.agent.configured) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequest.current = controller;
    setLoading(true);
    setResponse(null);
    try {
      const request = await fetch("/api/energy-ir/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: normalizedQuestion, context, history: history.slice(-6) }),
        signal: controller.signal,
      });
      const payload = await request.json() as QueryResponse;
      if (sequence !== requestSequence.current) return;
      setResponse(payload);
      setHistory((current) => [...current, { role: "user" as const, content: normalizedQuestion }, { role: "assistant" as const, content: payload.result?.summary ?? payload.message ?? payload.status }].slice(-6));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (sequence !== requestSequence.current) return;
      setResponse({ status: "unavailable", message: "问数接口当前不可用，未生成替代答案。", reasonCode: "network-unavailable" });
    } finally {
      if (sequence === requestSequence.current) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [agent?.agent.configured, context, history]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    void submitQuestion(question);
  };

  const result = response?.result;
  return (
    <aside className={styles.askPanel} aria-label="能源可信问数" aria-live="polite">
      <header className={styles.askHeader}>
        <div><p className={styles.eyebrow}>ENERGY IR · TRUSTED QUERY</p><h2>能源可信问数</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭能源问数">×</button>
      </header>
      <div className={`${styles.askPolicy} ${agent && !agent.agent.configured ? styles.askPolicyOffline : ""}`}><i /> {agent?.agent.configured ? `${agent.agent.provider} · ${agent.agent.model}` : "智能体未配置"} · 语义目录 {agent?.semanticCatalogVersion ?? "…"} · 只读 IR</div>
      <p className={styles.askContext}>当前上下文：{context.selectedProvince ?? "全国"} · {layerLabel(context.selectedLayer)} · {context.timeMode ?? "当前"}</p>
      {agent && !agent.agent.configured ? <p className={styles.askConfigWarning}>{agent.agent.reason}</p> : null}

      <p className={styles.voicePrivacy}>右下角小云支持实时语音和文字问数；此面板保留完整来源与执行轨迹。</p>

      <form className={styles.askForm} onSubmit={submit}>
        <label htmlFor="energy-question">询问设施来源、数据质量或图层可用性</label>
        <textarea id="energy-question" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} />
        <button type="submit" disabled={loading || !question.trim() || !agent?.agent.configured}>{loading ? "智能体正在规划与执行…" : agent?.agent.configured ? "交给 EnergyDataAgent" : "等待智能体配置"}</button>
      </form>

      <div className={styles.askSuggestions}>
        {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}
      </div>

      <section className={styles.askAnswer}>
        {!response && !loading ? <p className={styles.askEmpty}>模型只负责生成EnergyIR；智能体完成模式校验、白名单工具调用、结果验证和会话衔接，答案不会越过数据可用性门禁。</p> : null}
        {loading ? <p className={styles.askEmpty}>智能体正在规划EnergyIR、校验权限、调用只读工具并检查来源…</p> : null}
        {response && !result ? (
          <div className={`${styles.askMessage} ${styles[`ask${capitalize(response.status)}`] ?? ""}`}>
            <b>{statusLabel(response.status)}</b><p>{response.message}</p><small>{response.reasonCode}</small>
          </div>
        ) : null}
        {result ? (
          <>
            <div className={`${styles.askMessage} ${result.status === "answered" ? styles.askAnswered : styles.askUnavailable}`}>
              <b>{result.status === "answered" ? "已验证回答" : "数据不可用"}</b><p>{result.summary}</p>
            </div>
            <div className={styles.askFacts}>{result.facts.map((fact) => (
              <div key={`${fact.label}-${String(fact.value)}`}><span>{fact.label}</span><strong>{String(fact.value ?? "—")}</strong><small>{fact.unit}</small></div>
            ))}</div>
            {result.provenance.map((source) => (
              <div className={styles.askSource} key={`${source.source}-${source.identity}`}>
                <b>{source.source}</b><span>{source.identity} · {source.timeRange} · {source.freshness}</span><p>{source.limitation}</p>
              </div>
            ))}
            <details className={styles.askTrace}>
              <summary>查看 EnergyIR 与执行轨迹</summary>
              <pre>{JSON.stringify({ ir: response.ir, plan: response.plan, trace: response.trace }, null, 2)}</pre>
            </details>
          </>
        ) : null}
      </section>
    </aside>
  );
}

function layerLabel(layer?: string) {
  const labels: Record<string, string> = { "osm-power": "OSM电力设施", "gfs-weather": "GFS气象场", "graced-power": "GRACED Power", "vre-scenario": "VRE长期情景", "pv-footprint": "PV遥感足迹" };
  return layer ? labels[layer] ?? layer : "未选图层";
}

function statusLabel(status: QueryResponse["status"]) {
  return status === "clarification" ? "需要澄清" : status === "refused" ? "已拒绝" : status === "unavailable" ? "暂不可用" : "已计划";
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
