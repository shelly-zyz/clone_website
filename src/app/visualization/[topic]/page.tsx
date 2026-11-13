import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { globeTopicOrder } from "@/lib/globe-topics";
import { analysisTopics } from "@/lib/topic-analysis/catalog";
import { AnalysisHeader } from "../AnalysisHeader";
import { AnalysisWorkbench } from "../AnalysisWorkbench";
import styles from "../page.module.css";

type PageProps = { params: Promise<{ topic: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return globeTopicOrder.map(topic => ({ topic }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { topic } = await params;
  const key = globeTopicOrder.find(item => item === topic);
  if (!key) return { title: "专题分析 | OpenGridWorks" };
  return {
    title: analysisTopics[key].title + " | OpenGridWorks",
    description: analysisTopics[key].description,
  };
}

export default async function TopicAnalysisPage({ params }: PageProps) {
  const { topic } = await params;
  const key = globeTopicOrder.find(item => item === topic);
  if (!key) notFound();
  return (
    <main className={styles.page}>
      <div className={styles.hero}><AnalysisHeader topic={key} detail /></div>
      <AnalysisWorkbench topic={key} />
    </main>
  );
}
