import { demoReplayId } from "@/lib/weather-replay/model";
import { readBundledReplay, readWeatherReplay } from "@/lib/weather-replay/storage.server";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };
const archiveLookups = new Map<string | null, ReturnType<typeof readWeatherReplay>>();

async function preferPublishedReplay(id: string, version: string | null, archive: NonNullable<Awaited<ReturnType<typeof readBundledReplay>>>) {
  let lookup = archiveLookups.get(version);
  if (!lookup) {
    lookup = readWeatherReplay(id, version).catch(() => null).finally(() => archiveLookups.delete(version));
    archiveLookups.set(version, lookup);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1200); });
  try {
    return (await Promise.race([lookup, deadline])) ?? archive;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? demoReplayId;
  const version = params.get("version");
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || (version !== null && !/^[a-f0-9]{64}$/.test(version))) {
    return Response.json({ error: "无效的案例或版本。" }, { status: 400, headers: noStore });
  }
  try {
    const archive = await readBundledReplay(id, version).catch(() => null);
    const replay = archive ? await preferPublishedReplay(id, version, archive) : await readWeatherReplay(id, version);
    if (!replay) return Response.json({ error: "该区域回放尚未发布。" }, { status: 404, headers: noStore });
    return new Response(replay.body, {
      headers: {
        "Cache-Control": replay.source === "bundled-archive" ? "private, max-age=15"
          : version ? "private, max-age=31536000, immutable" : "private, max-age=30",
        "Content-Type": "application/json; charset=utf-8",
        ETag: `"${replay.version}"`,
        "X-Weather-Replay-Source": replay.source,
      },
    });
  } catch {
    console.warn("Weather replay storage or catalog query failed.");
    return Response.json({ error: "气象回放数据暂不可用。" }, { status: 503, headers: noStore });
  }
}
