import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildChinaDashboardOverview, type ChinaOfficialTotals } from "@/lib/china-dashboard";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SampleSummaryRow = {
  count: number;
  capacity_mw: number;
  source_count: number;
};

export async function GET() {
  const officialTotals = await readOfficialTotals();

  try {
    const sample = await withTimeout(queryDatabase<SampleSummaryRow>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(capacity_mw), 0)::float8 AS capacity_mw,
        COUNT(DISTINCT source)::int AS source_count
      FROM website_data.energy_assets
      WHERE country_code = 'CN'`,
    ), 1_800);
    const row = sample.rows[0];
    return NextResponse.json(buildChinaDashboardOverview({
      officialTotals,
      mappedSample: row
        ? { count: row.count, capacityMw: row.capacity_mw, sourceCount: row.source_count }
        : null,
    }));
  } catch (error) {
    console.error("China dashboard mapped sample request failed.", error);
    const snapshot = await readMappedSnapshot();
    return NextResponse.json(buildChinaDashboardOverview({ officialTotals, mappedSample: snapshot }));
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("China dashboard database query timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readOfficialTotals() {
  const file = path.join(process.cwd(), "public", "data", "china-validation", "official-totals.json");
  return JSON.parse(await fs.readFile(file, "utf8")) as ChinaOfficialTotals;
}

type CoverageSummary = {
  assetCapacityByTechnology?: Record<string, { count?: number; capacityMw?: number }>;
};

type GeneratedMapData = { meta?: { sources?: unknown[] } };

async function readMappedSnapshot() {
  try {
    const [coverageRaw, generatedRaw] = await Promise.all([
      fs.readFile(path.join(process.cwd(), "public", "data", "china-validation", "coverage-summary.json"), "utf8"),
      fs.readFile(path.join(process.cwd(), "src", "lib", "china-map-data.generated.json"), "utf8"),
    ]);
    const coverage = JSON.parse(coverageRaw) as CoverageSummary;
    const generated = JSON.parse(generatedRaw) as GeneratedMapData;
    const technologies = Object.values(coverage.assetCapacityByTechnology ?? {});
    return {
      count: technologies.reduce((sum, item) => sum + (item.count ?? 0), 0),
      capacityMw: technologies.reduce((sum, item) => sum + (item.capacityMw ?? 0), 0),
      sourceCount: generated.meta?.sources?.length ?? 0,
      status: "partial" as const,
      reason: "数据库当前不可用，使用同源构建产物快照。",
      note: "当前显示可追溯的本地构建快照；它仍是坐标样本，不等于官方全国总量。",
    };
  } catch {
    return null;
  }
}
