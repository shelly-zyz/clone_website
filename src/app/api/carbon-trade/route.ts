import { Pool } from "pg";
import type { TradeCatalog, TradeFlow } from "@/lib/carbon-trade";
import { getDatabasePool } from "@/lib/db";
import { mapJsonResponse } from "@/lib/map-json-response";

export const runtime = "nodejs";

const globalForTrade = globalThis as typeof globalThis & { carbonTradePool?: Pool };
const headers = { "Cache-Control": "public, max-age=60, stale-while-revalidate=60" };

function tradePool() {
  const connectionString = process.env.CARBON_TRADE_DATABASE_URL;
  if (!connectionString) return getDatabasePool();
  if (!globalForTrade.carbonTradePool) {
    const pool = new Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 3 });
    pool.on("error", error => console.error("Idle carbon trade database connection failed.", error.name));
    globalForTrade.carbonTradePool = pool;
  }
  return globalForTrade.carbonTradePool;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const year = query.get("year");
  const revision = query.get("revision");
  if (year !== null && (!/^\d{4}$/.test(year) || Number(year) < 1995 || Number(year) > 2022)) {
    return Response.json({ error: "年份须介于 1995 至 2022。" }, { status: 400 });
  }
  if (revision !== null && !/^[0-9a-f]{64}$/.test(revision)) {
    return Response.json({ error: "数据版本格式无效。" }, { status: 400 });
  }

  try {
    const pool = tradePool();
    if (year !== null) {
      const { rows: [frame] } = await pool.query<{ revision: string; flows: TradeFlow[] | null }>(`
        SELECT r.revision, (
          SELECT jsonb_agg(jsonb_build_array(exporter, importer, mt) ORDER BY mt DESC, exporter, importer)
          FROM carbon_trade.bilateral WHERE year = $1 AND mt > 0
        ) AS flows
        FROM carbon_trade.release r
      `, [Number(year)]);
      if (!frame?.flows) return Response.json({ error: "该年份尚无已入库的贸易数据。" }, { status: 404 });
      if (revision && frame.revision !== revision) {
        return Response.json({ error: "OECD 数据版本已更新，请重新加载。" }, { status: 409 });
      }
      return mapJsonResponse(request, { year: Number(year), ...frame }, headers);
    }

    const { rows: [catalog] } = await pool.query<TradeCatalog>(`
      WITH annual AS (
        SELECT year, economy,
          max(mt) FILTER (WHERE measure = 'PROD_GHG') AS production,
          max(mt) FILTER (WHERE measure = 'FD_GHG') AS consumption
        FROM carbon_trade.footprint GROUP BY economy, year
      ), series AS (
        SELECT economy, jsonb_agg(jsonb_build_array(year, production, consumption) ORDER BY year) AS points
        FROM annual WHERE production IS NOT NULL AND consumption IS NOT NULL GROUP BY economy
      )
      SELECT edition, revision, ARRAY(SELECT DISTINCT year FROM carbon_trade.bilateral ORDER BY year) AS years,
        (SELECT jsonb_object_agg(economy, points) FROM series) AS footprints
      FROM carbon_trade.release
    `);
    if (!catalog?.years.length) return Response.json({ error: "OECD 双边贸易数据尚未发布。" }, { status: 503 });
    return mapJsonResponse(request, catalog, headers);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P01" && code !== "42501") console.error("Could not read carbon trade data.", code);
    return Response.json({ error: "暂时无法读取 OECD 贸易数据，请稍后重试。" }, { status: 503 });
  }
}
