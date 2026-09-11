import { NextResponse } from "next/server";
import { normalizePredictionCountryCode } from "@/lib/prediction/status";
import { loadRealBaselineBacktest } from "@/lib/prediction/real-data-backtest-loader";
import { buildUnavailableRealBaselineBacktest } from "@/lib/prediction/real-data-backtest";

export async function GET(request: Request) {
  const country = normalizePredictionCountryCode(new URL(request.url).searchParams.get("country"));
  if (!country) {
    return NextResponse.json(buildUnavailableRealBaselineBacktest("国家代码无效，不能读取研究回测。"), { status: 400 });
  }
  if (country !== "CHN") {
    return NextResponse.json(buildUnavailableRealBaselineBacktest("当前只登记中国Hill of Towie研究回测；其他国家不继承中国数据。"));
  }
  const result = await loadRealBaselineBacktest();
  return NextResponse.json(result, { status: result.status === "research-only" ? 200 : 503 });
}
