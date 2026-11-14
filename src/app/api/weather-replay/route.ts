import { demoReplayId } from "@/lib/weather-replay/model";
import { readWeatherReplay } from "@/lib/weather-replay/storage.server";

export const runtime = "nodejs";

const cacheControl = "private, no-store";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? demoReplayId;
  const version = params.get("version");
  const headers = { "Cache-Control": cacheControl };
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || (version !== null && !/^[a-f0-9]{64}$/.test(version))) {
    return Response.json({ error: "无效的案例或版本。" }, { status: 400, headers });
  }
  try {
    const replay = await readWeatherReplay(id, version);
    if (!replay) return Response.json({ error: "该区域回放尚未发布。" }, { status: 404, headers });
    return new Response(replay.body, {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", ETag: `"${replay.version}"` },
    });
  } catch {
    console.warn("Weather replay storage or catalog query failed.");
    return Response.json({ error: "气象回放数据暂不可用。" }, { status: 503, headers });
  }
}
