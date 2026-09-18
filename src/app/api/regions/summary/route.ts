import { NextResponse } from "next/server";
import type { RegionTheme } from "@/lib/regions/contracts";
import { loadRegionSummary } from "@/lib/regions/summary.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const themes = new Set<RegionTheme>(["power", "weather", "carbon"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const regionId = params.get("regionId")?.trim() ?? "CN";
  const theme = params.get("theme")?.trim() as RegionTheme | null;
  if (!theme || !themes.has(theme) || !/^[\p{Script=Han}A-Za-z0-9_-]{1,32}$/u.test(regionId)) {
    return NextResponse.json({ error: "regionId 或 theme 无效。" }, { status: 400 });
  }
  try {
    const summary = await loadRegionSummary({ regionId, theme, metric: params.get("metric"), time: params.get("time") });
    return NextResponse.json(summary, { status: 200, headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("Region summary request failed.", error);
    return NextResponse.json({ error: "地区分析暂不可用。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
