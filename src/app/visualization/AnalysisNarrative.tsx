"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DataStory } from "@/lib/topic-analysis/data-story";
import type { Source } from "@/lib/topic-analysis/model";
import styles from "./power.module.css";

export function AnalysisInsights({ story, id }: { story: DataStory; id: string }) {
  return <aside className={styles.insight} aria-labelledby={id + "-findings"} aria-live="polite">
    <h3 id={id + "-findings"}>关键洞察</h3>
    <ul>{story.highlights.map(({ label, text }) => <li key={label}><strong>{label}</strong><p>{text}</p></li>)}</ul>
  </aside>;
}

export function AnalysisNarrative({ story, caption, sources, defaultOpen }: {
  story: DataStory; caption: string; sources: readonly Source[]; defaultOpen?: boolean;
}) {
  const [tab, setTab] = useState(1);
  return <details className={styles.report} open={defaultOpen || undefined}>
    <summary>深度分析报告 <ChevronDown size={15} aria-hidden /></summary>
    <div className={styles.reportBody}>
      <div className={styles.reportTabs} role="group" aria-label="解读维度">
        {story.sections.map(({ label }, index) => <button type="button" key={label}
          aria-pressed={index === tab} onClick={() => setTab(index)}>{label}</button>)}
      </div>
      <p aria-live="polite">{story.sections[tab].text}</p>
      <details className={styles.evidence}>
        <summary>分析依据 <ChevronDown size={13} aria-hidden /></summary>
        <p>{caption}</p>
        <ul>{sources.map(source => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer">{source.label}</a></li>)}</ul>
      </details>
    </div>
  </details>;
}
