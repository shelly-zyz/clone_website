import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const requirePostgresReplay = args.includes("--require-postgres-replay");
const addresses = args.filter(arg => arg !== "--require-postgres-replay");
const base = new URL(addresses[0] ?? "http://127.0.0.1:3193");
if (addresses.length > 1 || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  || base.protocol !== "http:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
  throw new Error("Usage: npm run check:preview -- [http://127.0.0.1:PORT] [--require-postgres-replay]");
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response;
}

async function check(label, run, attempts = 1) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const detail = await run();
      console.log(`通过 ${label} ${detail ?? ""}`.trim());
      return;
    } catch (error) {
      if (attempt < attempts) {
        await delay(500 * attempt);
        continue;
      }
      console.error(`失败 ${label} ${error.message}`);
      process.exitCode = 1;
    }
  }
}

async function checkVoice(action, body, contentType, valid) {
  const token = process.env.DATA_AGENT_TOKEN?.trim();
  const response = await request(`/api/xiaoyun/voice?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": contentType, ...(token && { Authorization: "Bearer " + token }) },
    body,
  });
  assert(valid(await response.json()), "语音服务返回了无效响应");
}

await Promise.all([
  check("PostgreSQL", async () => {
    const health = await (await request("/api/database/health")).json();
    assert(health.ok && health.database === "zyz", "未连到 zyz");
    return health.database;
  }),
  check("气象回放", async () => {
    const response = await request("/api/weather-replay");
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    const replay = JSON.parse(bytes);
    const source = response.headers.get("x-weather-replay-source");
    assert(response.headers.get("etag") === `"${digest}"`, "回放 SHA-256 与版本不一致");
    assert(replay.rows > 1 && replay.cols > 1 && replay.rain.length && replay.satellite.length
      && [...replay.rain, ...replay.satellite].every(frame => frame.values.length === replay.rows * replay.cols),
    "云图或降水格点不完整");
    if (requirePostgresReplay) assert(source === "postgres", `回放来自 ${source}，尚未验证数据库直读`);
    return `${replay.satellite.length} 帧云图、${replay.rain.length} 帧降水（${source}）`;
  }),
  check("电力设施", async () => {
    const data = await (await request("/api/data/map-assets")).json();
    assert(data.energyAssets.length && Array.isArray(data.dataCenters), "电力设施首批数据为空");
    return `首批 ${data.energyAssets.length} 条`;
  }),
  check("碳排放网格", async () => {
    const catalog = await (await request("/api/carbon-earth?request=catalog")).json();
    const sector = catalog.sectors.includes("Power") ? "Power" : catalog.sectors[0];
    const latest = catalog.frames.findLast(frame => frame.sector === sector);
    assert(latest, "无已发布排放帧");
    const query = new URLSearchParams({ request: "frame", sector, date: latest.date, meta: "1" });
    const response = await request("/api/carbon-earth?" + query);
    const meta = JSON.parse(response.headers.get("x-carbon-metadata"));
    const data = gunzipSync(Buffer.from(await response.arrayBuffer()));
    assert(data.length === meta.grid.width * meta.grid.height * 4, "碳排放网格字节数不匹配");
    return latest.date;
  }),
  check("经济资料", async () => {
    const [wdi, gep] = await Promise.all(["wdi", "gep"].map(async id =>
      (await request(`/data/economy/${id}.json`)).json()));
    assert(wdi.countries.length && wdi.years.length && gep.years.length && gep.values.WLT.length, "经济资料不完整");
    return `${wdi.countries.length} 个经济体`;
  }),
  check("首页资源", async () => {
    const [page, earth] = await Promise.all([request("/"), request("/earth/index.html?workspace")]);
    assert((await page.text()).includes("OpenGridWorks") && (await earth.text()).includes('id="animation"'), "页面内容不完整");
  }),
  check("小云语音识别", () => checkVoice("transcribe", new Uint8Array(3200), "application/octet-stream",
    result => typeof result.text === "string"), 2),
  check("小云语音合成", () => checkVoice("synthesize", JSON.stringify({ text: "小云语音就绪" }), "application/json",
    result => typeof result.audio === "string" && Buffer.from(result.audio, "base64").length > 0), 2),
]);
