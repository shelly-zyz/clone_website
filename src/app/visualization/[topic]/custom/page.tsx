import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { analysisHref, analysisTopicOrder, analysisTopics } from "@/lib/topic-analysis/catalog";
import { AnalysisHeader } from "../../AnalysisHeader";
import pageStyles from "../../page.module.css";
import { CustomChartStudio } from "./CustomChartStudio";

export const metadata: Metadata = { title: "自定义制图 | OpenGridWorks" };
export const dynamicParams = false;

export function generateStaticParams() {
  return analysisTopicOrder.map(topic => ({ topic }));
}

export default async function CustomChartPage({ params, searchParams }: {
  params: Promise<{ topic: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ topic }, search] = await Promise.all([params, searchParams]);
  const key = analysisTopicOrder.find(item => item === topic);
  if (!key) notFound();

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (Array.isArray(value)) value.forEach(item => query.append(name, item));
    else if (value !== undefined) query.set(name, value);
  }
  const config = analysisTopics[key];
  return (
    <main className={pageStyles.page}>
      <div className={pageStyles.hero}><AnalysisHeader topic={config.globe} detail /></div>
      <CustomChartStudio topicName={config.title} backHref={analysisHref(key) + (query.size ? "?" + query.toString() : "")} />
    </main>
  );
}
