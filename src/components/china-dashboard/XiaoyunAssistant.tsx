"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceAssistant } from "@xiaoyun/voice";
import type { DashboardQueryContext, EnergyResult } from "@/lib/energy-ir/schema";
import { classifyVoiceUtterance, type VoiceDashboardCommand } from "@/lib/voice/voice-state";
import styles from "./china-dashboard.module.css";

export function XiaoyunAssistant({ context, onDashboardCommand, onOpenPanel }: {
  context: DashboardQueryContext;
  onDashboardCommand: (command: VoiceDashboardCommand) => void;
  onOpenPanel: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const voice = useRef<VoiceAssistant | null>(null);
  const callbacks = useRef({ context, onDashboardCommand, onOpenPanel });
  const [notice, setNotice] = useState("文字问数 · 浏览器语音");
  const [mode, setMode] = useState<"native" | "browser">("native");
  useEffect(() => {
    callbacks.current = { context, onDashboardCommand, onOpenPanel };
  }, [context, onDashboardCommand, onOpenPanel]);
  useEffect(() => {
    voice.current?.updateContext({ page: "china-dashboard", ...context });
  }, [context.selectedProvince, context.selectedLayer, context.selectedFacility, context.timeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let disposed = false;
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    void import("@xiaoyun/voice").then(({ createVoiceAssistant }) => {
      if (disposed || !mount.current) return;
      const selectProvince = (province: string) => {
        callbacks.current.onDashboardCommand({ type: "select-province", province });
        voice.current?.updateContext({ page: "china-dashboard", ...callbacks.current.context, selectedProvince: province });
        return { province };
      };
      voice.current = createVoiceAssistant({
        projectId: "power-earth", container: mount.current, assetBaseUrl: "/xiaoyun/", mode: "live", backendUrl: "http://127.0.0.1:8765",
        context: { page: "china-dashboard", ...callbacks.current.context },
        ui: { theme: "power-earth", baseFontSize: 13, position: { right: window.innerWidth >= 1100 ? 450 : 28, bottom: 105 } },
        actions: [{
          name: "select_province", description: "切换地图范围，与省份按钮共用操作。",
          parameters: { type: "object", properties: { province: { type: "string", enum: ["全国", "新疆", "内蒙古", "四川", "山东", "广东"] } }, required: ["province"], additionalProperties: false },
          execute: ({ province }) => selectProvince(String(province)),
        }],
        browserAdapter: mode === "native" ? undefined : {
          async submit(question, snapshot, signal) {
            signal.throwIfAborted();
            const utterance = classifyVoiceUtterance(question);
            if (utterance.kind === "dashboard-command") {
              if (utterance.command.type === "select-province") selectProvince(utterance.command.province);
              else callbacks.current.onDashboardCommand(utterance.command);
              return { summary: utterance.command.type === "select-province" ? `已切换到${utterance.command.province}。` : "已关闭问数面板。" };
            }
            if (/^(请)?打开(能源)?问数(面板)?[。！!]?$/u.test(question)) {
              callbacks.current.onOpenPanel(); return { summary: "已打开能源可信问数面板。" };
            }
            const response = await fetch("/api/energy-ir/query", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question, context: snapshot, history: history.slice(-6) }),
              signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
            });
            const answer = await response.json() as { status: string; message?: string; result?: EnergyResult };
            signal.throwIfAborted();
            if (!response.ok) throw new Error(answer.message ?? "问数服务暂不可用，请重试。");
            const summary = answer.result?.summary ?? answer.message;
            if (!summary) throw new Error("未收到有效回答，请重试。");
            history.push({ role: "user", content: question }, { role: "assistant", content: summary });
            history.splice(0, Math.max(0, history.length - 6));
            const result = answer.result;
            return {
              summary, data: { kind: "energy-ir", status: answer.status, result },
              markdown: result ? [
                "### 数据与口径", ...result.facts.map(fact => `- ${escapeMarkdown(fact.label)}：${escapeMarkdown(String(fact.value ?? "未知"))} ${escapeMarkdown(fact.unit)}`),
                "\n### 来源", ...result.provenance.map(source => `- ${escapeMarkdown(source.source)} · ${escapeMarkdown(source.timeRange)}\n  ${escapeMarkdown(source.limitation)}`),
              ].join("\n") : undefined,
            };
          },
        },
        onEvent(event) {
          if (disposed) return;
          if (event.type === "error") setNotice(String(event.message));
          if (event.type === "ready") setNotice(mode === "native" ? "Qwen 实时语音 · DeepSeek 问数" : "浏览器语音 · DeepSeek 问数");
          if (event.type === "input.text") setNotice("正在查询项目数据…");
          if (event.type === "action.executed" || event.type === "playback.finished") setNotice(mode === "native" ? "Qwen 实时语音 · DeepSeek 问数" : "浏览器语音 · DeepSeek 问数");
          if (event.type === "input.transcript") setNotice(`识别：${String(event.text).slice(0, 60)}`);
          if (event.type === "session.end") setNotice("麦克风已关闭");
        },
        onTaskResult() { if (!disposed) setNotice(mode === "native" ? "Qwen 实时语音 · DeepSeek 问数" : "浏览器语音 · DeepSeek 问数"); },
      });
    }).catch(() => { if (!disposed) setNotice("小云加载失败，请刷新页面或使用能源问数面板。"); });
    return () => { disposed = true; voice.current?.destroy(); voice.current = null; };
  }, [mode]);

  return <div ref={mount} className={styles.xiaoyunHost}>
    <div className={styles.xiaoyunNotice}>
      <strong>小云 · 电力研究助手</strong><span role="status">{notice}</span>
      <small>{mode === "native" ? "默认不录音；开启后音频由 Qwen 实时服务处理。" : "开启后由浏览器语音服务识别。"}点击键盘可文字问数。</small>
      <button type="button" onClick={() => { setMode(mode === "native" ? "browser" : "native"); setNotice("正在切换语音模式…"); }}>{mode === "native" ? "切换浏览器语音" : "切换 Qwen 实时语音"}</button>
    </div>
  </div>;
}

function escapeMarkdown(value: string) { return value.replace(/[\\`*_{}[\]<>|]/g, "\\$&"); }
