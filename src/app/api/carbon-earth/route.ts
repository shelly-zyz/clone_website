import { gunzipSync } from "node:zlib";
import { queryDatabase } from "@/lib/db";

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

type CarbonFrameRow = {
  observed_on: string;
  sector: string;
  unit: string;
  width: number;
  height: number;
  longitude_min: number;
  latitude_max: number;
  dx: number;
  dy: number;
  frame_sha256: string;
  frame_data: Buffer;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sectorPattern = /^[A-Za-z]+$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestType = url.searchParams.get("request") ?? "manifest";

  try {
    if (requestType === "manifest") {
      return Response.json(await readManifest(), {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      });
    }

    if (requestType === "frame") {
      const observedOn = url.searchParams.get("date");
      const sector = url.searchParams.get("sector");
      if (!observedOn || !datePattern.test(observedOn) || !sector || !sectorPattern.test(sector)) {
        return Response.json({ error: "Expected a valid date and sector." }, { status: 400 });
      }
      return readFrame(observedOn, sector, url.searchParams.get("raw") === "1");
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

  const frames = framesResult.rows.map((row) => ({
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
  }));
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

async function readFrame(observedOn: string, sector: string, raw: boolean) {
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
       frame_sha256,
       frame_data
     FROM website_data.carbon_emission_frames
     WHERE observed_on = $1::date AND sector = $2`,
    [observedOn, sector],
  );
  const frame = result.rows[0];
  if (!frame) {
    return Response.json({ error: "Carbon frame not found." }, { status: 404 });
  }

  const payload = raw ? gunzipSync(frame.frame_data) : frame.frame_data;
  return new Response(new Uint8Array(payload), {
    headers: {
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
