import { NextResponse } from "next/server";
import { publicUrlToDatabasePath } from "@/lib/database-data-path";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonDocumentRow = {
  payload: unknown;
};

type ClimateHourlyRow = {
  gcm: string;
  scenario: string;
  region_id: string;
  year: number;
  technology: string;
  region_label: string;
  capacity_mw: number;
  scale: number;
  hours: number;
  values_json: number[];
  stats: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestType = url.searchParams.get("request");

    if (requestType === "manifest" || requestType === "summary") {
      const publicPath = requestType === "manifest"
        ? "/data/climate-vre/manifest.json"
        : "/data/climate-vre/summary.json";
      const result = await queryDatabase<JsonDocumentRow>(
        "SELECT payload FROM website_data.json_documents WHERE path = $1",
        [publicUrlToDatabasePath(publicPath)],
      );
      const document = result.rows[0];
      return document
        ? NextResponse.json(document.payload)
        : NextResponse.json({ error: "Climate document was not found." }, { status: 404 });
    }

    if (requestType === "hourly") {
      const regionId = url.searchParams.get("regionId");
      const technology = url.searchParams.get("technology");
      const year = Number(url.searchParams.get("year"));
      const gcm = url.searchParams.get("gcm") || "gfdl-esm4";
      const scenario = url.searchParams.get("scenario") || "ssp126";

      if (!gcm || !scenario || !regionId || !technology || !Number.isInteger(year)) {
        return NextResponse.json({ error: "gcm, scenario, regionId, technology, and year are required." }, { status: 400 });
      }

      const result = await queryDatabase<ClimateHourlyRow>(
        `SELECT gcm, scenario, region_id, year, technology, region_label, capacity_mw, scale,
                hours, values_json, stats, metadata
         FROM website_data.climate_vre_hourly
         WHERE gcm = $1 AND scenario = $2 AND region_id = $3 AND year = $4 AND technology = $5`,
        [gcm, scenario, regionId, year, technology],
      );
      const row = result.rows[0];
      if (!row) {
        return NextResponse.json({ error: "Climate hourly data was not found." }, { status: 404 });
      }

      return NextResponse.json({
        ...row.metadata,
        gcm: row.gcm,
        scenario: row.scenario,
        regionId: row.region_id,
        regionLabel: row.region_label,
        technology: row.technology,
        year: row.year,
        capacityMw: row.capacity_mw,
        scale: row.scale,
        hours: row.hours,
        values: row.values_json,
        stats: row.stats,
      });
    }

    return NextResponse.json({ error: "Unknown climate data request." }, { status: 400 });
  } catch (error) {
    console.error("Database climate request failed.", error);
    return NextResponse.json({ error: "Climate data is unavailable." }, { status: 503 });
  }
}
