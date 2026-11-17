import type { Metadata } from "next";
import { readReplayRegion } from "@/lib/weather-replay/regions";
import { AnalysisHeader } from "../AnalysisHeader";
import styles from "../page.module.css";
import { WeatherReplayPlayer } from "./WeatherReplayPlayer";

export const metadata: Metadata = {
  title: "区域 3D 回放 | OpenGridWorks",
  description: "播放 SatWeave 红外云图和 PARDIG 降水估计，查看云雨叠加和雨带随时间的变化。",
};

type PageProps = { searchParams: Promise<{ id?: string | string[]; version?: string | string[]; region?: string | string[] }> };

export default async function WeatherReplayPage({ searchParams }: PageProps) {
  const { id, version, region } = await searchParams;
  const query = new URLSearchParams();
  if (typeof id === "string") query.set("id", id);
  if (typeof version === "string") query.set("version", version);
  return (
    <main className={styles.page}>
      <div className={styles.hero}><AnalysisHeader topic="weather" detail /></div>
      <WeatherReplayPlayer key={query.toString()} query={query.toString()} region={readReplayRegion(typeof region === "string" ? region : null)} />
    </main>
  );
}
