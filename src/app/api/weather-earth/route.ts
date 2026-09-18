import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { queryDatabase } from "@/lib/db";
import { evaluateWeatherFreshness } from "@/lib/weather-freshness";
import {
  WEATHER_METRICS,
  type WeatherField,
  type WeatherManifest,
  type WeatherMetricKey,
  type WeatherStatus,
  weatherMetricEndpoint,
} from "@/lib/weather-earth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cacheDir = path.join(process.cwd(), ".weather-cache");
const projectWeatherPython = path.resolve(
  process.cwd(),
  "..",
  "outputs",
  "20260904-pg-migration",
  "venv",
  "Scripts",
  "python.exe",
);
const refreshTimeoutMs = 6 * 60 * 1000;
let refreshPromise: Promise<void> | null = null;

const metricKeys = new Set<WeatherMetricKey>(WEATHER_METRICS.map((metric) => metric.key));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestType = url.searchParams.get("request");
  const metric = url.searchParams.get("metric") as WeatherMetricKey | null;

  if (requestType === "manifest") {
    await ensureFreshCache();
    const manifest = await readManifest();
    return manifest
      ? NextResponse.json(manifest)
      : NextResponse.json({ error: "Real GFS weather data is unavailable." }, { status: 503 });
  }

  if (requestType === "status") {
    return NextResponse.json(await readStatus());
  }

  if (metric) {
    if (!metricKeys.has(metric)) {
      return NextResponse.json({ error: "Unknown weather metric." }, { status: 400 });
    }

    await ensureFreshCache();
    const field = await readField(metric);
    return field
      ? NextResponse.json(field)
      : NextResponse.json({ error: "Real GFS weather field is unavailable." }, { status: 503 });
  }

  return NextResponse.json({ error: "Expected request=manifest or a metric parameter." }, { status: 400 });
}

async function ensureFreshCache() {
  const manifest = await readCachedManifest();
  const freshness = evaluateWeatherFreshness(manifest?.generatedAt, manifest?.runTimeUtc);
  if (manifest && !freshness.stale) {
    return;
  }

  if (!refreshPromise) {
    refreshPromise = runRefreshScript().finally(() => {
      refreshPromise = null;
    });
  }
  void refreshPromise.catch(() => {});
}

async function readManifest(): Promise<WeatherManifest | null> {
  return readCachedManifest();
}

async function readField(metric: WeatherMetricKey): Promise<WeatherField | null> {
  try {
    const raw = await fs.readFile(path.join(cacheDir, `${metric}.json`), "utf8");
    return JSON.parse(raw) as WeatherField;
  } catch {
    return null;
  }
}

async function readCachedManifest() {
  try {
    const raw = await fs.readFile(path.join(cacheDir, "manifest.json"), "utf8");
    return normalizeManifest(JSON.parse(raw) as WeatherManifest);
  } catch {
    return null;
  }
}

async function readStatus(): Promise<WeatherStatus> {
  const manifest = await readCachedManifest();
  const freshness = evaluateWeatherFreshness(manifest?.generatedAt, manifest?.runTimeUtc);
  const fieldFilesPresent = await metricPresence();
  const wgrib2 = spawnSync("wgrib2", ["-version"], { encoding: "utf8", windowsHide: true, timeout: 1_500 });
  const wgrib2Available = !wgrib2.error && wgrib2.status === 0;
  const pythonCommand = process.env.WEATHER_PYTHON
    || (existsSync(projectWeatherPython) ? projectWeatherPython : "python");
  const eccodes = spawnSync(pythonCommand, ["-c", "import eccodes"], { encoding: "utf8", windowsHide: true, timeout: 1_500 });
  const eccodesAvailable = !eccodes.error && eccodes.status === 0;
  const decoderAvailable = wgrib2Available || eccodesAvailable;
  const [syncState, database] = await Promise.all([readSyncState(), readDatabaseState(manifest?.validTimeUtc ?? null)]);
  const message = freshness.stale
    ? `GFS缓存已过期${freshness.runAgeHours === null ? "" : `（起报距今 ${freshness.runAgeHours} 小时）`}，后台刷新已触发。`
    : manifest?.message ?? (!decoderAvailable ? "未检测到wgrib2或ecCodes，无法刷新真实GFS气象数据。" : undefined);

  return {
    wgrib2Available,
    decoderAvailable,
    decoderName: wgrib2Available ? "wgrib2" : (eccodesAvailable ? "python-eccodes" : null),
    cacheFresh: freshness.cacheFresh,
    runFresh: freshness.runFresh,
    stale: freshness.stale,
    cacheAgeMinutes: freshness.ageMinutes,
    runAgeHours: freshness.runAgeHours,
    refreshStatus: freshness.stale ? "error" : manifest?.refreshStatus ?? "error",
    generatedAt: manifest?.generatedAt ?? null,
    validTimeUtc: manifest?.validTimeUtc ?? null,
    fieldFilesPresent,
    message,
    lastRefreshError: syncState.state === "failed" ? syncState.error ?? message : undefined,
    database,
    pipeline: {
      state: syncState.state,
      stages: syncState.stages,
      failedAt: syncState.failedAt,
    },
  };
}

type SyncState = {
  state: "idle" | "running" | "complete" | "failed";
  stages: Record<string, { status?: string; startedAt?: string; finishedAt?: string }>;
  failedAt?: string;
  error?: string;
};

async function readSyncState(): Promise<SyncState> {
  try {
    const raw = await fs.readFile(path.join(cacheDir, "live-sync-status.json"), "utf8");
    const value = JSON.parse(raw) as Partial<SyncState> & { ok?: boolean };
    return {
      state: value.state ?? (value.ok ? "complete" : value.failedAt ? "failed" : "idle"),
      stages: value.stages ?? {},
      failedAt: value.failedAt,
      error: value.error,
    };
  } catch {
    return { state: "idle", stages: {} };
  }
}

async function readDatabaseState(cacheValidTimeUtc: string | null): Promise<WeatherStatus["database"]> {
  try {
    const result = await Promise.race([
      queryDatabase<{ latest_valid: string | null }>(
        "SELECT max(valid_time_utc)::text AS latest_valid FROM website_data.weather_forecast_fields WHERE source='GFS'",
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("weather database check timed out")), 1_800)),
    ]);
    const latest = result.rows[0]?.latest_valid ?? null;
    const inSync = Boolean(latest && cacheValidTimeUtc && Date.parse(latest) >= Date.parse(cacheValidTimeUtc));
    return { latestValidTimeUtc: latest, inSyncWithCache: inSync, status: inSync ? "current" : "behind" };
  } catch {
    return { latestValidTimeUtc: null, inSyncWithCache: false, status: "unavailable" };
  }
}

async function metricPresence() {
  const entries = await Promise.all(WEATHER_METRICS.map(async (metric) => {
    try {
      await fs.stat(path.join(cacheDir, `${metric.key}.json`));
      return [metric.key, true] as const;
    } catch {
      return [metric.key, false] as const;
    }
  }));

  return Object.fromEntries(entries) as Record<WeatherMetricKey, boolean>;
}

function normalizeManifest(manifest: WeatherManifest): WeatherManifest {
  const metricMap = new Map(manifest.metrics.map((metric) => [metric.key, metric]));
  const freshness = evaluateWeatherFreshness(manifest.generatedAt, manifest.runTimeUtc);
  return {
    ...manifest,
    stale: freshness.stale,
    refreshStatus: freshness.stale
      ? "cached"
      : manifest.refreshStatus === "live" || manifest.refreshStatus === "cached" ? manifest.refreshStatus : "error",
    message: freshness.stale
      ? `缓存已过期；起报距今 ${freshness.runAgeHours ?? "未知"} 小时。`
      : manifest.message,
    metrics: WEATHER_METRICS.map((metric) => ({
      ...metric,
      kind: metric.key === "wind" ? "vector" : "scalar",
      endpoint: metricMap.get(metric.key)?.endpoint ?? weatherMetricEndpoint(metric.key),
      nativeLevelLabel: metricMap.get(metric.key)?.nativeLevelLabel ?? "surface",
    })),
  };
}

function runRefreshScript() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/sync-live-weather.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Weather refresh timed out."));
    }, refreshTimeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Weather refresh exited with ${code ?? "unknown"}.`));
      }
    });
  });
}
