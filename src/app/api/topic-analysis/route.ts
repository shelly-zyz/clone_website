import { DataAgentError } from "@/lib/data-agent/database.server";
import { publishedAnalysisTopics } from "@/lib/topic-analysis/history";
import { readPublishedHistory, readRegionalGeneration } from "@/lib/topic-analysis/published.server";
import { readRenewableScenario } from "@/lib/topic-analysis/scenario.server";

export const runtime = "nodejs";

const cacheHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const topic = params.get("topic");
  const month = params.get("month");
  const version = params.get("version");
  try {
    if (topic === "renewables" && month === null && version === null) {
      return Response.json(await readRenewableScenario(), { headers: cacheHeaders });
    }
    if (topic === "generation" && month && /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(month)
      && version && /^[0-9a-f]{64}$/.test(version)) {
      return Response.json(await readRegionalGeneration(month, version), { headers: cacheHeaders });
    }
    const published = publishedAnalysisTopics.find(item => item === topic);
    if (published && month === null && version === null) {
      return Response.json(await readPublishedHistory(published), { headers: cacheHeaders });
    }
    return Response.json({ error: "无效的专题或报告期。" }, { status: 400, headers: cacheHeaders });
  } catch (error) {
    const unavailable = error instanceof DataAgentError && error.code === "VERSION_NOT_FOUND";
    if (!(error instanceof DataAgentError)) console.warn("Published analysis history query failed.");
    return Response.json(
      { error: unavailable ? "尚无已发布的专题数据。" : "专题数据库暂不可用。" },
      { status: unavailable ? 404 : 503, headers: cacheHeaders },
    );
  }
}
