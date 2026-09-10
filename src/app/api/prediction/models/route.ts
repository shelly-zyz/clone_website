import { NextResponse } from "next/server";
import { loadSdwpfPilotSummary } from "@/lib/prediction/pilot-storage";
import { buildModelRegistry } from "@/lib/prediction/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
