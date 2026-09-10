import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildChinaDashboardQuality, type ChinaOfficialTotals } from "@/lib/china-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeneratedMeta = { meta?: { sources?: unknown[] } };

export async function GET() {
  const [officialTotals, generated] = await Promise.all([
    readJson<ChinaOfficialTotals>(path.join(process.cwd(), "public", "data", "china-validation", "official-totals.json")),
    readJson<GeneratedMeta>(path.join(process.cwd(), "src", "lib", "china-map-data.generated.json")),
  ]);

  if (!officialTotals) {
    return NextResponse.json({ error: "Official China totals are unavailable." }, { status: 503 });
  }

  return NextResponse.json(buildChinaDashboardQuality({
    officialTotals,
    mappedSourceCount: generated?.meta?.sources?.length ?? 0,
  }));
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}
