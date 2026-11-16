import { gunzipSync } from "node:zlib";
import type { CarbonCatalog } from "@/lib/carbon-earth";
import { queryDatabase } from "@/lib/db";
import { mapJsonResponse } from "@/lib/map-json-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CarbonManifestRow = {
  observed_on: string;
  sector: string;
  unit: string;
  width: number;
  height: number;
  longitude_min: number;
  latitude_max: number;
  dx: number;
  dy: number;
  min_value: number;
  max_value: number;
  mean_value: number;
  sum_kgc_per_hour: number;
  nonzero_count: number;
  statistics: Record<string, number>;
  frame_size_bytes: number;
};

type CarbonSourceRow = {
  sector: string;
  data_month: string;
  file_name: string;
  source_url: string;
  api_updated_at: string | null;
  source_attributes: Record<string, string>;
};

type CarbonFrameRow = Omit<CarbonManifestRow, "frame_size_bytes"> & {
  frame_sha256: string;
  frame_data: Buffer;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sectorPattern = /^[A-Za-z]+$/;
let catalogRequest: ReturnType<typeof readCatalog> | undefined;
let catalogExpiresAt = 0;
const frameCache = new Map<string, { request: Promise<CarbonFrameRow | undefined>; expiresAt: number }>();

function loadCatalog() {
  if (!catalogRequest || Date.now() >= catalogExpiresAt) {
    catalogExpiresAt = Infinity;
    catalogRequest = readCatalog().then((catalog) => {
      catalogExpiresAt = Date.now() + 60_000;
      return catalog;
    }).catch((error: unknown) => {
      catalogRequest = undefined;
      catalogExpiresAt = 0;
      throw error;
    });
  }
  return catalogRequest;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestType = url.searchParams.get("request") ?? "manifest";

  try {
    if (requestType === "manifest") {
      return mapJsonResponse(request, await readManifest(), {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      });
    }
    if (requestType === "catalog") {
      return mapJsonResponse(request, await loadCatalog(), {
        "Cache-Control": "public, max-age=60",
      });
    }

    if (requestType === "frame") {
      const observedOn = url.searchParams.get("date");
      const sector = url.searchParams.get("sector");
      if (!observedOn || !datePattern.test(observedOn) || !sector || !sectorPattern.test(sector)) {
        return Response.json({ error: "Expected a valid date and sector." }, { status: 400 });
      }
      return await readFrame(observedOn, sector, url.searchParams.get("raw") === "1", url.searchParams.get("meta") === "1");
    }

    return Response.json({ error: "Unknown carbon-earth request." }, { status: 400 });
  } catch (error) {
    console.error("Carbon Earth API request failed.", error);
    return Response.json(
      { error: "Carbon emission data is currently unavailable." },
      { status: 503 },
    );
  }
}

async function readCatalog(): Promise<CarbonCatalog> {
  const [catalog, sources] = await Promise.all([
    queryDatabase<{ sector: string; entries: [string, number][] | null; scale: number }>(
      `SELECT sector,
         json_agg(json_build_array(observed_on, sum_kgc_per_hour) ORDER BY observed_on)
           FILTER (WHERE octet_length(frame_data) > 0) AS entries,
         greatest(1,
           max((statistics->>'p99')::double precision) FILTER (WHERE octet_length(frame_data) > 0),
           max((statistics->>'p95')::double precision) FILTER (WHERE octet_length(frame_data) > 0)) AS scale
       FROM website_data.carbon_emission_frames
       GROUP BY sector ORDER BY sector`,
    ),
    queryDatabase<Pick<CarbonSourceRow, "sector" | "data_month" | "file_name" | "source_url">>(
      `SELECT sector, data_month::text, file_name, source_url
       FROM website_data.carbon_source_archives ORDER BY data_month DESC, sector`,
    ),
  ]);
  return {
    sectors: catalog.rows.map(row => row.sector),
    frames: catalog.rows.flatMap(row => (row.entries ?? []).map(([date, sumKgCPerHour]) => ({
      date, sector: row.sector, stats: { sumKgCPerHour },
    }))),
    scales: Object.fromEntries(catalog.rows.map(row => [row.sector, row.scale])),
    sources: sources.rows.map(row => ({
      sector: row.sector, month: row.data_month.slice(0, 7), fileName: row.file_name, url: row.source_url,
    })),
  };
}

async function readManifest() {
  const framesResult = await queryDatabase<CarbonManifestRow>(
      `SELECT
         observed_on::text,
         sector,
         unit,
         width,
         height,
         longitude_min,
         latitude_max,
         dx,
         dy,
         min_value,
         max_value,
         mean_value,
         sum_kgc_per_hour,
         nonzero_count,
         statistics,
         octet_length(frame_data) AS frame_size_bytes
       FROM website_data.carbon_emission_frames
       WHERE octet_length(frame_data) > 0
       ORDER BY observed_on, sector`,
    );
  const sourcesResult = await queryDatabase<CarbonSourceRow>(
      `SELECT
         sector,
         data_month::text,
         file_name,
         source_url,
         api_updated_at::text,
         source_attributes
       FROM website_data.carbon_source_archives
       ORDER BY data_month DESC, sector`,
    );

  const frames = framesResult.rows.map(frameMetadata);
  const dates = [...new Set(frames.map((frame) => frame.date))];
  const sectors = [...new Set(frames.map((frame) => frame.sector))];

  return {
    generatedAt: new Date().toISOString(),
    dates,
    sectors,
    latestDate: dates.at(-1) ?? null,
    frames,
    sources: sourcesResult.rows.map((row) => ({
      sector: row.sector,
      month: row.data_month.slice(0, 7),
      fileName: row.file_name,
      url: row.source_url,
      apiUpdatedAt: row.api_updated_at,
      attributes: row.source_attributes,
    })),
  };
}

function frameMetadata(row: CarbonManifestRow) {
  return {
    date: row.observed_on,
    sector: row.sector,
    unit: row.unit,
    grid: {
      width: row.width,
      height: row.height,
      longitudeMin: row.longitude_min,
      latitudeMax: row.latitude_max,
      dx: row.dx,
      dy: row.dy,
    },
    stats: {
      ...row.statistics,
      min: row.min_value,
      max: row.max_value,
      mean: row.mean_value,
      sumKgCPerHour: row.sum_kgc_per_hour,
      nonzeroCount: row.nonzero_count,
    },
    sizeBytes: row.frame_size_bytes,
    endpoint: `/api/carbon-earth?request=frame&date=${row.observed_on}&sector=${row.sector}`,
  };
}

async function selectFrame(observedOn: string, sector: string) {
  const result = await queryDatabase<CarbonFrameRow>(
    `SELECT
       observed_on::text,
       sector,
       unit,
       width,
       height,
       longitude_min,
       latitude_max,
       dx,
       dy,
       min_value,
       max_value,
       mean_value,
       sum_kgc_per_hour,
       nonzero_count,
       statistics,
       frame_sha256,
       frame_data
     FROM website_data.carbon_emission_frames
     WHERE observed_on = $1::date AND sector = $2`,
    [observedOn, sector],
  );
  return result.rows[0];
}

function loadFrame(observedOn: string, sector: string) {
  const key = sector + "/" + observedOn;
  const cached = frameCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.request;

  const entry = { request: selectFrame(observedOn, sector), expiresAt: Infinity };
  entry.request = entry.request.then(frame => {
    if (frame?.frame_data.length) entry.expiresAt = Date.now() + 120_000;
    else if (frameCache.get(key) === entry) frameCache.delete(key);
    return frame;
  }).catch(error => {
    if (frameCache.get(key) === entry) frameCache.delete(key);
    throw error;
  });
  frameCache.delete(key);
  frameCache.set(key, entry);
  if (frameCache.size > 4) {
    const oldest = frameCache.keys().next().value;
    if (oldest !== undefined) frameCache.delete(oldest);
  }
  return entry.request;
}

async function readFrame(observedOn: string, sector: string, raw: boolean, includeMetadata: boolean) {
  const frame = await loadFrame(observedOn, sector);
  if (!frame?.frame_data.length) {
    return Response.json({ error: "Carbon frame not found." }, { status: 404 });
  }

  const payload = raw ? gunzipSync(frame.frame_data) : frame.frame_data;
  return new Response(new Uint8Array(payload), {
    headers: {
      ...(includeMetadata ? { "X-Carbon-Metadata": JSON.stringify(frameMetadata({ ...frame, frame_size_bytes: frame.frame_data.length })) } : {}),
      "Content-Type": raw ? "application/octet-stream" : "application/gzip",
      "Content-Length": String(payload.length),
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Carbon-Date": frame.observed_on,
      "X-Carbon-Sector": frame.sector,
      "X-Carbon-Unit": frame.unit,
      "X-Carbon-Grid": `${frame.width}x${frame.height}`,
      "X-Carbon-Longitude-Min": String(frame.longitude_min),
      "X-Carbon-Latitude-Max": String(frame.latitude_max),
      "X-Carbon-Dx": String(frame.dx),
      "X-Carbon-Dy": String(frame.dy),
      "X-Carbon-Sha256": frame.frame_sha256,
      "X-Carbon-Compression": raw ? "none" : "gzip",
    },
  });
}
