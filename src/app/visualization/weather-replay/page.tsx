import type { Metadata } from "next";
import { readReplayRegion } from "@/lib/weather-replay/regions";
import { WeatherReplayPlayer } from "./WeatherReplayPlayer";

export const metadata: Metadata = {
  title: "区域 3D 回放 | OpenGridWorks",
  description: "播放 SatWeave 红外云图和 PARDIG 降水估计，查看云雨结构、降水演变、热点和累计降水。",
};

type PageProps = { searchParams: Promise<{ id?: string | string[]; version?: string | string[]; region?: string | string[] }> };

export default async function WeatherReplayPage({ searchParams }: PageProps) {
  const { id, version, region } = await searchParams;
  const query = new URLSearchParams();
  if (typeof id === "string") query.set("id", id);
  if (typeof version === "string") query.set("version", version);
  return <WeatherReplayPlayer key={query.toString()} query={query.toString()} region={readReplayRegion(typeof region === "string" ? region : null)} />;
}
