import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { globeTopicOrder, resolveWorkspaceTopic } from "@/lib/globe-topics";
import { analysisHref, analysisTopics } from "@/lib/topic-analysis/catalog";
import { defaultAnalysis } from "@/lib/topic-analysis/data";
import { AnalysisHeader } from "./AnalysisHeader";
import { AnalysisPlot } from "./AnalysisPlot";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "专题分析 | OpenGridWorks",
  description: "交互探索电力、气象、碳排放和经济数据的结构与趋势。",
};

export default async function VisualizationPage({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const { topic } = await searchParams;
  const current = resolveWorkspaceTopic(topic);

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <AnalysisHeader topic={current} />
        <section className={styles.heroContent} aria-labelledby="visualization-title">
          <div className={styles.heroCopy}>
            <h1 id="visualization-title">专题分析</h1>
            <p>探索电力、气象、碳排放和经济数据的结构与趋势。</p>
            <a className={styles.browseLink} href="#topics">浏览专题 <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          <Image
            className={styles.heroImage}
            src="/intro/graced-night-v1.webp"
            alt="全球电力部门排放在夜间地球上的分布"
            width={960}
            height={960}
            sizes="(max-width: 680px) 48vw, 310px"
            loading="eager"
          />
        </section>
      </div>
      <section id="topics" className={styles.gallery} aria-label="分析专题">
        <div className={styles.grid}>
          {globeTopicOrder.map(key => {
            const config = analysisTopics[key];
            const { charts, scope } = defaultAnalysis(key);
            return (
              <Link key={key} href={analysisHref(key)} className={styles.topicCard} data-topic={key}>
                <div>
                  <h2>{config.title}</h2>
                  <p>{config.description}</p>
                </div>
                <div className={styles.cardChart}>
                  <strong>{config.preview}</strong>
                  <AnalysisPlot spec={charts[0]} compact />
                  <p>{scope}</p>
                </div>
                <span className={styles.cardLink}>进入{config.label}专题 <ArrowUpRight size={17} aria-hidden="true" /></span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
