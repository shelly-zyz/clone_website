"use client";

import { useState, type FormEvent } from "react";

type Batch = {
  id: string;
  period_month: string;
  source_url: string;
  source_sha256: string;
  issues: string[];
  observations: { metric_code: string; series_code: string; product_name: string; value: string }[];
  current_values: Record<string, string | null> | null;
  status: "pending" | "published" | "rejected";
  version: string | null;
  review_note: string | null;
};

const statusNames = { pending: "待复核", published: "已发布", rejected: "已驳回" };
const metricNames: Record<string, string> = {
  electricity_generation_current: "本期值",
  electricity_generation_yoy: "本期同比",
  electricity_generation_cumulative: "累计值",
  electricity_generation_cumulative_yoy: "累计同比",
};

export default function DataReviewPage() {
  const [token, setToken] = useState("");
  const [batches, setBatches] = useState<Batch[]>();
  const [lastCheck, setLastCheck] = useState<{ checked_at: string; status: "ok" | "failed" }>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function request(decision?: { batch_id: string; approve: boolean; note: string }) {
    setBusy(true);
    setMessage("");
    const headers = { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" };
    try {
      if (decision) {
        const response = await fetch("/api/data-agent/review", { method: "POST", headers, body: JSON.stringify(decision) });
        if (!response.ok) throw new Error((await response.json()).error);
      }
      const response = await fetch("/api/data-agent/review", { headers, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBatches(data.batches);
      setLastCheck(data.last_check ?? undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审核服务暂不可用。");
    } finally {
      setBusy(false);
    }
  }

  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void request();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-2xl font-semibold">数据批次审核</h1>
        <p className="text-sm text-slate-600">国家统计局月度数据 · 查看来源、校验结果和发布记录</p>
        <form onSubmit={load} className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">审核令牌
            <input type="password" autoComplete="off" required value={token} onChange={(event) => {
              setToken(event.target.value);
              setBatches(undefined);
              setLastCheck(undefined);
              setNotes({});
            }} className="rounded border bg-white px-3 py-2" />
          </label>
          <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">读取批次</button>
        </form>
        {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
        {lastCheck && <p className="text-sm text-slate-600">
          最近检查 {new Date(lastCheck.checked_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", timeZoneName: "short" })}
          {" · "}{lastCheck.status === "ok" ? "成功" : "失败"}
        </p>}
        {batches?.length === 0 && <p>暂无批次记录。</p>}
        {batches?.map((batch) => (
          <article key={batch.id} className="space-y-3 rounded-lg border bg-white p-4">
            <div className="flex justify-between gap-3">
              <h2 className="font-medium">{batch.period_month.slice(0, 7)} 月度发布</h2>
              <span className="rounded bg-slate-100 px-2 py-1 text-xs">{statusNames[batch.status]}</span>
            </div>
            <a href={batch.source_url} target="_blank" rel="noreferrer" className="text-sm text-blue-700 underline">国家统计局原文</a>
            <p className="break-all text-xs text-slate-500">来源 SHA-256 {batch.source_sha256}</p>
            {!!batch.issues.length && <ul className="list-disc pl-5 text-sm text-red-700">{batch.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
            <details className="text-sm">
              <summary className="cursor-pointer">查看 {batch.observations.length} 项数值</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">{batch.observations.map((row) => {
                const key = `${row.metric_code}:${row.series_code}`;
                const before = batch.current_values?.[key];
                const unit = row.metric_code.endsWith("_yoy") ? "%" : row.series_code === "natural-gas" ? "亿立方米"
                  : row.metric_code.startsWith("electricity_") ? "亿千瓦时" : "万吨";
                return <li key={key}>{row.product_name} {metricNames[row.metric_code] ?? "本期值"} {before !== undefined && `${before ?? "缺测"} → `}{row.value} {unit}</li>;
              })}</ul>
            </details>
            {batch.review_note && <p className="text-sm text-slate-600">{batch.review_note}</p>}
            {batch.version && <p className="break-all text-xs text-slate-500">发布版本 {batch.version}</p>}
            {batch.status === "pending" && (
              <div className="space-y-2">
                <label className="grid gap-1 text-sm">审核原因
                  <textarea value={notes[batch.id] ?? ""} maxLength={500}
                    onChange={(event) => setNotes({ ...notes, [batch.id]: event.target.value })}
                    className="rounded border px-3 py-2" />
                </label>
                <div className="flex gap-2">
                  {[true, false].map((approve) => (
                    <button key={String(approve)} disabled={busy || !notes[batch.id]?.trim() || (approve && !!batch.issues.length)}
                      onClick={() => void request({ batch_id: batch.id, approve, note: notes[batch.id] })}
                      className="rounded border px-3 py-1 text-sm disabled:opacity-40">{approve ? "批准发布" : "驳回"}</button>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
