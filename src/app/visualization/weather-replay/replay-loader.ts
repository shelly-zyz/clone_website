import type { WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayGeography } from "./replay-geography";

async function fetchGeography(global: boolean) {
  const path = global ? "/data/natural-earth/ne_50m_admin_0_countries.geojson" : "/data/weather-replay/regions.geojson";
  const response = await fetch(path, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("区域边界暂不可用。");
  return response.json() as Promise<ReplayGeography>;
}

async function fetchReplay(query: string) {
  const response = await fetch(query ? "/api/weather-replay?" + query : "/api/weather-replay", {
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) {
    const payload: { error?: string } | null = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "暂时无法加载区域回放。");
  }
  const replay = await response.json() as WeatherReplay;
  const cells = replay.rows * replay.cols;
  if (!Number.isSafeInteger(cells) || replay.rows < 2 || replay.cols < 2 || !replay.rain?.length || !replay.satellite?.length
    || [...replay.rain, ...replay.satellite].some(frame => frame.values?.length !== cells)) {
    throw new Error("该案例的云图或降水帧不完整。");
  }
  return { replay, localArchive: response.headers.get("X-Weather-Replay-Source") === "bundled-archive" };
}

const geographyRequests = new Map<boolean, Promise<ReplayGeography>>();
const requests = new Map<string, { data: ReturnType<typeof fetchReplay>; expiresAt: number }>();

export async function loadWeatherReplayData(query = "", global = false) {
  let geographyRequest = geographyRequests.get(global);
  if (!geographyRequest) {
    geographyRequest = fetchGeography(global).catch(error => {
      geographyRequests.delete(global);
      throw error;
    });
    geographyRequests.set(global, geographyRequest);
  }
  let entry = requests.get(query);
  if (!entry || Date.now() >= entry.expiresAt) {
    const next = { data: fetchReplay(query), expiresAt: Infinity };
    next.data = next.data.then(replay => {
      next.expiresAt = new URLSearchParams(query).has("version") ? Infinity : Date.now() + 60_000;
      return replay;
    }).catch(error => {
      if (requests.get(query) === next) requests.delete(query);
      throw error;
    });
    requests.delete(query);
    requests.set(query, next);
    if (requests.size > 4) {
      const key = requests.keys().next().value;
      if (key !== undefined) requests.delete(key);
    }
    entry = next;
  }
  const [archive, geography] = await Promise.all([entry.data, geographyRequest]);
  return { ...archive, geography };
}
