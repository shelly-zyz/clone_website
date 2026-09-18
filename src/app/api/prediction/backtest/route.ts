import { NextResponse } from "next/server";
import { normalizePredictionCountryCode } from "@/lib/prediction/status";
import { loadRealBaselineBacktest } from "@/lib/prediction/real-data-backtest-loader";
import { buildUnavailableRealBaselineBacktest } from "@/lib/prediction/real-data-backtest";

export async function GET(request: Request) {
  const country = normalizePredictionCountryCode(new URL(request.url).searchParams.get("country"));
  if (!country) {
    return NextResponse.json(buildUnavailableRealBaselineBacktest("国家代码无效，不能读取研究回测。"), { status: 400 });
  }
  if (country !== "GBR") {
    return NextResponse.json(buildUnavailableRealBaselineBacktest("当前真实小时配对仅登记英国 Hill of Towie 场站；该证据不会用于中国或其他国家。"));
  }
  const result = await loadRealBaselineBacktest();
  return NextResponse.json(result, { status: result.status === "research-only" ? 200 : 503 });
}
