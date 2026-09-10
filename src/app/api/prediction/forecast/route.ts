import { NextResponse } from "next/server";
import { loadSdwpfPilotSummary } from "@/lib/prediction/pilot-storage";
import { buildLockedForecast, buildPredictionStatus, normalizePredictionCountryCode } from "@/lib/prediction/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const countryCode = normalizePredictionCountryCode(new URL(request.url).searchParams.get("country"));
  if (!countryCode) {
    return NextResponse.json({
      schemaVersion: 1,
      status: "invalid",
      output: null,
      reason: "country 必须是三位英文字母国家代码。",
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const pilot = countryCode === "CHN" ? await loadSdwpfPilotSummary() : null;
    const status = buildPredictionStatus(pilot, countryCode);
    return NextResponse.json(buildLockedForecast(status), {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "86400" },
    });
  } catch {
    return NextResponse.json({
      schemaVersion: 1,
      status: "invalid",
      output: null,
      reason: "本地预测证据文件无法验证。",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
