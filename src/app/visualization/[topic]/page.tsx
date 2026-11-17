import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { analysisTopicOrder, analysisTopics } from "@/lib/topic-analysis/catalog";
import { AnalysisHeader } from "../AnalysisHeader";
import { AnalysisWorkbench } from "../AnalysisWorkbench";
import styles from "../page.module.css";

type PageProps = {
  params: Promise<{ topic: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return analysisTopicOrder.map(topic => ({ topic }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { topic } = await params;
  const key = analysisTopicOrder.find(item => item === topic);
  if (!key) return { title: "专题分析 | OpenGridWorks" };
  return {
    title: analysisTopics[key].title + " | OpenGridWorks",
    description: analysisTopics[key].description,
  };
}

export default async function TopicAnalysisPage({ params, searchParams }: PageProps) {
  const [{ topic }, query] = await Promise.all([params, searchParams]);
  const key = analysisTopicOrder.find(item => item === topic);
  if (!key) notFound();
  const initialQuery = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") initialQuery.set(name, value);
    else if (value) value.forEach(item => initialQuery.append(name, item));
  }
  return (
    <main className={styles.page} id="topic-analysis-page">
      <div className={styles.hero}><AnalysisHeader topic={analysisTopics[key].globe} detail /></div>
      <AnalysisWorkbench key={key} topic={key} initialQuery={initialQuery.toString()} />
    </main>
  );
}
