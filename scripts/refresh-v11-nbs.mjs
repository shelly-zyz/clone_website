import pg from "pg";

const index = "https://www.stats.gov.cn/sj/zxfb/";
const titlePattern = /^(\d{4})年(\d{1,2})月份规模以上工业增加值/;
const articlePath = /^\/sj\/zxfb\/\d{6}\/t\d{8}_\d+\.html$/;
const products = [
  ["规模以上工业发电量（亿千瓦时）", "electricity", "发电量"],
  ["火力发电量（亿千瓦时）", "thermal-power", "火力发电量"],
  ["水力发电量（亿千瓦时）", "hydro-power", "水力发电量"],
  ["核能发电量（亿千瓦时）", "nuclear-power", "核能发电量"],
  ["风力发电量（亿千瓦时）", "wind-power", "风力发电量"],
  ["太阳能发电量（亿千瓦时）", "solar-power", "太阳能发电量"],
  ["原煤（万吨）", "raw-coal", "原煤产量", "raw_coal_production_current"],
  ["原油（万吨）", "crude-oil", "原油产量", "crude_oil_production_current"],
  ["原油加工量（万吨）", "crude-processing", "原油加工量", "crude_oil_processing_current"],
  ["天然气（亿立方米）", "natural-gas", "天然气产量", "natural_gas_production_current"],
];

function text(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim();
}

async function getHtml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    throw new Error(`NBS HTTP ${response.status}`);
  }
  const html = await response.text();
  if (Buffer.byteLength(html) > 2_000_000) throw new Error("NBS response is too large");
  return html;
}

function releases(indexHtml) {
  const candidates = new Map();
  for (const link of indexHtml.matchAll(/<a\b[^>]*\bhref=(["'])([^"']+)\1[^>]*>([^<]+)<\/a>/gi)) {
    const title = text(link[3]);
    const match = title.match(titlePattern);
    if (!match) continue;
    const url = new URL(link[2], index);
    if (url.origin !== new URL(index).origin || !articlePath.test(url.pathname) || url.search || url.hash) continue;
    const month = Number(match[2]);
    // The combined January–February report cannot represent a single month.
    if (month < 3 || month > 12) continue;
    const period = `${match[1]}-${String(month).padStart(2, "0")}-01`;
    candidates.set(url.href, { url: url.href, period, title });
  }
  return [...candidates.values()].sort((a, b) => b.period.localeCompare(a.period));
}

function parseRelease(html, release) {
  const issues = [];
  if (!html.includes(`name="ArticleTitle" content="${release.title}"`)) {
    return { observations: [], issues: ["正文标题与发布索引不一致"] };
  }
  const matching = [];
  const month = Number(release.period.slice(5, 7));
  for (const table of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1]).replace(/\s/g, "")));
    if (!rows.some((row) => row.includes(`${month}月`) && row.some((cell) => new RegExp(`^1[—–-]${month}月$`).test(cell)))) continue;
    if (!rows.some((row) => row[0] === products[0][0])) continue;
    matching.push(rows);
  }
  if (!matching.length) return { observations: [], issues: ["未找到与报告期一致的主要产品产量表"] };

  const observations = [];
  for (const [label, series, name, fuelMetric] of products) {
    const rows = matching.flatMap((table) => table.filter((row) => row[0] === label));
    const distinct = [...new Set(rows.map((row) => JSON.stringify(row)))];
    const row = rows[0];
    if (distinct.length !== 1 || row.length !== 5 || row.slice(1).some((value) => !/^-?\d+(\.\d+)?$/.test(value))) {
      issues.push(`${label} 缺失、重复冲突或字段格式变化`);
      continue;
    }
    const metrics = series === "electricity"
      ? ["electricity_generation_current", "electricity_generation_yoy", "electricity_generation_cumulative", "electricity_generation_cumulative_yoy"]
      : [fuelMetric ?? "electricity_generation_current"];
    metrics.forEach((metric, i) => observations.push({ metric_code: metric, series_code: series, product_name: name, value: row[i + 1] }));
  }
  return { observations, issues };
}

const connectionString = process.env.DATA_AGENT_INGEST_DATABASE_URL;
if (!connectionString) throw new Error("Set DATA_AGENT_INGEST_DATABASE_URL");
const connection = new URL(connectionString);
if (process.env.DATA_AGENT_INGEST_DB_HOST) connection.hostname = process.env.DATA_AGENT_INGEST_DB_HOST;
const client = new pg.Client({ connectionString: connection.href, connectionTimeoutMillis: 7000, statement_timeout: 60000 });
const completed = [];
let canLog = false;
async function record(status, details) {
  await client.query("INSERT INTO staging.nbs_refresh_run (status, details) VALUES ($1,$2)", [status, JSON.stringify(details)]);
}
try {
  await client.connect();
  await client.query("SET ROLE green_agent_ingest");
  canLog = true;
  const candidates = releases(await getHtml(index));
  if (!candidates.length) throw new Error("The official NBS index has no matching monthly release");
  for (const release of candidates.slice(0, process.argv.includes("--index-backfill") ? undefined : 1)) {
    const html = await getHtml(release.url);
    const { observations, issues } = parseRelease(html, release);
    const { rows } = await client.query("SELECT * FROM staging.submit_nbs_release($1,$2,$3,$4,$5)",
      [release.period, release.url, html, JSON.stringify(observations), JSON.stringify(issues)]);
    const outcome = { period: release.period, ...rows[0], issues };
    completed.push(outcome);
    console.log(JSON.stringify(outcome));
  }
  await record("ok", { completed });
} catch (error) {
  console.error("NBS refresh failed", error.code ?? error.name, error.message);
  if (canLog) await record("failed", { completed, error: error.code ?? error.name }).catch(() => {});
  process.exitCode = 1;
} finally {
  await client.end();
}
