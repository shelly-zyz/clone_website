import { NextResponse } from "next/server";
import { loadSdwpfPilotSummary } from "@/lib/prediction/pilot-storage";
import { loadRealForecastDataReadiness } from "@/lib/prediction/real-data-loader";
import { buildPredictionStatus, normalizePredictionCountryCode } from "@/lib/prediction/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const countryCode = normalizePredictionCountryCode(new URL(request.url).searchParams.get("country"));
  if (!countryCode) {
    return NextResponse.json({
      schemaVersion: 1,
      status: "invalid",
      productionReady: false,
      reason: "country 必须是三位英文字母国家代码。",
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const [pilot, realData] = await Promise.all([
      countryCode === "CHN" ? loadSdwpfPilotSummary() : Promise.resolve(null),
      countryCode === "CHN" ? loadRealForecastDataReadiness() : Promise.resolve(null),
    ]);
    const status = buildPredictionStatus(pilot, countryCode, realData);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      schemaVersion: 1,
      status: "invalid",
      productionReady: false,
      reason: "本地预测证据文件无法验证。",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
