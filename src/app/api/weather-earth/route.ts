import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  WEATHER_METRICS,
  type WeatherField,
  type WeatherManifest,
  type WeatherMetricKey,
  type WeatherStatus,
  weatherMetricEndpoint,
} from "@/lib/weather-earth";
import { sampleWeatherField, sampleWeatherManifest } from "@/lib/weather-earth-sample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cacheDir = path.join(process.cwd(), ".weather-cache");
const cacheMaxAgeMs = 75 * 60 * 1000;
const refreshTimeoutMs = 120 * 1000;
let refreshPromise: Promise<void> | null = null;

const metricKeys = new Set<WeatherMetricKey>(WEATHER_METRICS.map((metric) => metric.key));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestType = url.searchParams.get("request");
  const metric = url.searchParams.get("metric") as WeatherMetricKey | null;

  if (requestType === "manifest") {
    await ensureFreshCache();
    return NextResponse.json(await readManifest());
  }

  if (requestType === "status") {
    return NextResponse.json(await readStatus());
  }

  if (metric) {
    if (!metricKeys.has(metric)) {
      return NextResponse.json({ error: "Unknown weather metric." }, { status: 400 });
    }

    await ensureFreshCache();
    return NextResponse.json(await readField(metric));
  }

  return NextResponse.json({ error: "Expected request=manifest or a metric parameter." }, { status: 400 });
}

async function ensureFreshCache() {
  const manifest = await readCachedManifest();
  const generatedAt = manifest ? Date.parse(manifest.generatedAt) : 0;
  if (manifest && Number.isFinite(generatedAt) && Date.now() - generatedAt < cacheMaxAgeMs) {
    return;
  }

  if (!refreshPromise) {
    refreshPromise = runRefreshScript().finally(() => {
      refreshPromise = null;
    });
  }

  try {
    await refreshPromise;
  } catch {
    // The response readers below fall back to cached or sample data.
  }
}

async function readManifest(): Promise<WeatherManifest> {
  const manifest = await readCachedManifest();
  if (manifest) {
    return manifest;
  }
  return sampleWeatherManifest("自动实时气象缓存尚不可用，当前显示内置演示场。");
}

async function readField(metric: WeatherMetricKey): Promise<WeatherField> {
  try {
    const raw = await fs.readFile(path.join(cacheDir, `${metric}.json`), "utf8");
    return JSON.parse(raw) as WeatherField;
  } catch {
    return sampleWeatherField(metric);
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
  const generatedAt = manifest ? Date.parse(manifest.generatedAt) : 0;
  const cacheFresh = Boolean(manifest && Number.isFinite(generatedAt) && Date.now() - generatedAt < cacheMaxAgeMs);
  const fieldFilesPresent = await metricPresence();
  const wgrib2 = spawnSync("wgrib2", ["-version"], { encoding: "utf8", windowsHide: true });
  const wgrib2Available = !wgrib2.error && wgrib2.status === 0;
  const message = manifest?.message
    ?? (!wgrib2Available ? "wgrib2 is not installed or not available; showing the built-in sample weather field." : undefined);

  return {
    wgrib2Available,
    cacheFresh,
    refreshStatus: manifest?.refreshStatus ?? "error",
    generatedAt: manifest?.generatedAt ?? null,
    validTimeUtc: manifest?.validTimeUtc ?? null,
    fieldFilesPresent,
    message,
    lastRefreshError: manifest?.refreshStatus === "error" || manifest?.refreshStatus === "sample-fallback" ? message : undefined,
  };
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
  return {
    ...manifest,
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
    const child = spawn(process.execPath, ["scripts/update-weather-earth-data.mjs", "--quiet"], {
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
