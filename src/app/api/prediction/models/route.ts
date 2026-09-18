import { NextResponse } from "next/server";
import { loadSdwpfPilotSummary } from "@/lib/prediction/pilot-storage";
import { buildModelRegistry } from "@/lib/prediction/registry";
import { normalizePredictionCountryCode } from "@/lib/prediction/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const country = normalizePredictionCountryCode(new URL(request.url).searchParams.get("country"));
  if (country !== "CHN") {
    return NextResponse.json(buildModelRegistry(null), {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const registry = buildModelRegistry(await loadSdwpfPilotSummary());
    return NextResponse.json(registry, {
      status: registry.status === "unavailable" ? 404 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({
      schemaVersion: 1,
      status: "invalid",
      productionPromotionAllowed: false,
      reason: "本地模型登记证据无法验证。",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
