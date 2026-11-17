import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChartArea, ChevronDown } from "lucide-react";
import { resolveWorkspaceTopic } from "@/lib/globe-topics";
import { analysisGroups, analysisHref, analysisTopics, type AnalysisTopic } from "@/lib/topic-analysis/catalog";
import { buildCarbonAnalysis, buildRenewableAnalysis, buildWeatherAnalysis, carbonDates } from "@/lib/topic-analysis/climate";
import { buildEconomyAnalysis, buildOutlookAnalysis, buildTradeAnalysis, latestEconomyYear, outlookYears } from "@/lib/topic-analysis/economics";
import { buildFuelAnalysis, buildGenerationAnalysis, buildPowerAnalysis, powerYears } from "@/lib/topic-analysis/energy";
import { archivedRenewableScenario } from "@/lib/topic-analysis/scenario.server";
import { AnalysisGroupNav } from "./AnalysisGroupNav";
import { AnalysisHeader } from "./AnalysisHeader";
import { AnalysisPlot } from "./AnalysisPlot";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "专题分析 | OpenGridWorks",
  description: "交互探索电力与能源、风光气候情景、碳排放和经济与贸易数据。",
};

const periods: Record<AnalysisTopic, string> = {
  power: "2020–2025 年度统计",
  generation: "月度发电统计",
  fuels: "2020–2025 年度统计",
  weather: "GFS 预报归档",
  renewables: "2021–2060 气候情景",
  carbon: "GRACED 研究估算",
  economy: "2015–2024 WDI 历史数据",
  trade: "2015–2024 WDI 历史数据",
  outlook: "2026–2028 世界银行预测",
};

function preview(topic: AnalysisTopic) {
  switch (topic) {
    case "power": return buildPowerAnalysis(powerYears[0]).charts[0];
    case "generation": return buildGenerationAnalysis("electricity", "", null, null).charts[0];
    case "fuels": return buildFuelAnalysis("raw-coal", null).charts[0];
    case "renewables": return buildRenewableAnalysis(archivedRenewableScenario(), "china", 2050, "wind").charts[0];
    case "weather": return buildWeatherAnalysis("global").charts[0];
    case "carbon": {
      const { charts } = buildCarbonAnalysis(carbonDates[carbonDates.length - 1], null);
      return charts.find(chart => chart.kind === "calendar") ?? charts[0];
    }
    case "economy": return buildEconomyAnalysis("CHN", latestEconomyYear, "perCapita").charts[0];
    case "trade": return buildTradeAnalysis("CHN", latestEconomyYear).charts[0];
    case "outlook": return buildOutlookAnalysis("CHN", outlookYears[0]).charts[0];
  }
}

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
            <p>从发电与气候到排放与贸易，用多年数据看清结构、地域与季节变化。</p>
            <a className={styles.browseLink} href="#energy">
              浏览专题 <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
            </a>
          </div>
          <div className={styles.heroVisual}>
            <div className={styles.orbit} aria-hidden="true" />
            <Image
              className={styles.heroImage}
              src="/intro/graced-night-v1.webp"
              alt="GRACED 全球电力部门碳排放分布"
              width={960}
              height={960}
              sizes="(max-width: 680px) 40vw, 345px"
              loading="eager"
            />
          </div>
        </section>
      </div>
      <AnalysisGroupNav />
      <div className={styles.gallery}>
        {analysisGroups.map(group => (
          <section key={group.id} id={group.id} className={styles.group} aria-labelledby={group.id + "-title"}>
            <h2 id={group.id + "-title"}>{group.label}</h2>
            <div className={styles.grid} data-count={group.topics.length}>
              {group.topics.map(key => {
                const config = analysisTopics[key];
                const spec = preview(key);
                return (
                  <Link key={key} href={analysisHref(key)} className={styles.topicCard} data-topic={key} prefetch={false}>
                    <div className={styles.cardTitle}>
                      <h3>{config.title}</h3>
                      <span className={styles.cardArrow} aria-hidden="true"><ArrowUpRight size={17} strokeWidth={1.8} /></span>
                    </div>
                    <p>{config.description}</p>
                    <div className={styles.cardChart}>
                      <AnalysisPlot spec={spec} compact />
                    </div>
                    <div className={styles.cardFooter}>
                      <span><ChartArea size={14} aria-hidden="true" />{spec.label}</span>
                      <span>{periods[key]}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
