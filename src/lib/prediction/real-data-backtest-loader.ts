import "server-only";

import { queryDatabase } from "@/lib/db";
import { buildRealBaselineBacktest, buildUnavailableRealBaselineBacktest, type RealTrainingPairRow } from "./real-data-backtest";

const ENTITY_ID = "hill-of-towie";

type PairRow = {
  observed_at: string;
  observed_power_mw: number | string;
  quality_code: string;
};

type CurtailmentRow = { rows: number };

export async function loadRealBaselineBacktest() {
  try {
    const [pairs, curtailment] = await Promise.all([
      queryDatabase<PairRow>(
        `SELECT observed_at::text AS observed_at,observed_power_mw::float AS observed_power_mw,quality_code
         FROM website_data.forecast_training_pairs
         WHERE entity_id=$1
         ORDER BY observed_at`,
        [ENTITY_ID],
      ),
      queryDatabase<CurtailmentRow>(
        `SELECT count(*) FILTER (WHERE curtailment_known)::int AS rows
         FROM website_data.forecast_training_pairs
         WHERE entity_id=$1`,
        [ENTITY_ID],
      ),
    ]);
    const rows: RealTrainingPairRow[] = pairs.rows.map((row) => ({
      observedAt: row.observed_at,
      observedPowerMw: Number(row.observed_power_mw),
      qualityCode: row.quality_code,
    }));
    return buildRealBaselineBacktest(rows, { curtailmentKnownRows: Number(curtailment.rows[0]?.rows ?? 0) });
  } catch (error) {
    console.error("Real forecast baseline backtest query failed.", error);
    return buildUnavailableRealBaselineBacktest("服务器真实小时配对当前无法现场读取，回测结果保持不可用。", new Date().toISOString());
  }
}
