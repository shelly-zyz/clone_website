"use client";

import { ArrowUpRight, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useXiaoyunChartRequest } from "@/components/opengridworks/XiaoyunAssistant";
import { XiaoyunChartPreview, XiaoyunChartStory } from "@/components/opengridworks/XiaoyunBusinessCard";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import type { XiaoyunBusinessResult } from "@/lib/xiaoyun/contracts";
import styles from "./studio.module.css";

const examples = {
  power: "用国家统计局 2025 年 3 月各省发电量本期值做一张冰蓝色排序点图。",
  weather: "把最近一次查询的风速数据画成薄荷青趋势带，说明主要变化。",
  carbon: "用 2025 年 8 月的全球电力部门日度排放速率做一张雾紫趋势带。",
  economy: "用国家统计局 2025 年 3 月全国发电量本期值做一张雾紫柱状图。",
} satisfies Record<WorkspaceTopic, string>;

export function AgentChartStudio({ topic }: { topic: WorkspaceTopic }) {
  const request = useXiaoyunChartRequest();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [chart, setChart] = useState<Extract<XiaoyunBusinessResult, { kind: "chart" }>>();

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request || !prompt.trim() || busy) return;
    setBusy(true);
    setNotice("正在准备数据与图表…");
    try {
      const result = await request(`请自定义制图，并附文字分析：${prompt.trim()}`);
      setNotice(result.chart ? "图表已生成。" : result.summary);
      if (result.chart) setChart(result.chart);
    } catch {
      setNotice("暂时无法提交制图，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.agent} aria-labelledby="agent-chart-title">
    <div className={styles.agentIntro}>
      <span><Sparkles size={14} aria-hidden /> 小云 · 智能体制图</span>
      <h2 id="agent-chart-title">描述你想比较什么</h2>
      <p>小云从已发布的电力、气象和碳排放数据中查找指标，生成图表和可回查的文字解读。</p>
    </div>
    <form className={styles.agentForm} onSubmit={generate}>
      <label htmlFor="agent-chart-prompt">制图要求</label>
      <textarea id="agent-chart-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={2}
        maxLength={275} placeholder="写下指标、地区、时段与想要的图型或配色。" />
      <div className={styles.agentActions}>
        <button className={styles.agentExample} type="button" onClick={() => setPrompt(examples[topic])}>填入示例</button>
        <button className={styles.agentButton} type="submit" disabled={!request || !prompt.trim() || busy}>
          {busy ? "正在生成…" : "让小云制图"} <ArrowUpRight size={15} aria-hidden />
        </button>
      </div>
      {notice && <p className={styles.agentNotice} role="status">{notice}</p>}
    </form>
    {chart && <section className={styles.agentOutput} key={chart.chartId} aria-label="智能体生成结果">
      <h3>{chart.title}</h3>
      <XiaoyunChartPreview chart={chart} size="dialog" />
      <XiaoyunChartStory chart={chart} />
    </section>}
  </section>;
}
