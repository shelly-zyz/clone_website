import "server-only";

import { queryDatabase } from "@/lib/db";
import { buildRealDataReadiness, buildUnavailableRealDataEvidence } from "./real-data-readiness";

const SCADA_SOURCE_ID = "hill-of-towie-v2-2025";
const NWP_SOURCE_ID = "noaa-ncei-gfs-forecast-grid004";
const ENTITY_ID = "hill-of-towie";

type SourceRow = { import_status: string; entity_id: string };
type TurbineStatsRow = {
  turbines: number;
  valid_coordinates: number;
  installed_capacity_mw: number | string | null;
};
type ObservationStatsRow = {
  rows: number;
  earliest_utc: string | null;
  latest_utc: string | null;
  missing_power_rows: number;
  negative_rows: number;
  suspect_rows: number;
  complete_hourly_candidates: number;
  invalid_hourly_windows: number;
};
type SignalStatsRow = {
  rows: number;
  missing_quality_rows: number;
  source_reduced_power_rows: number;
  source_reduced_power_seconds_rows: number;
  source_reduced_power_seconds: number | string | null;
};
type PointStatsRow = {
  rows: number;
  future_issue_rows: number;
  non_valid_rows: number;
};
type PairStatsRow = {
  rows: number;
  earliest_utc: string | null;
  latest_utc: string | null;
  future_issue_rows: number;
  mismatched_valid_times: number;
  capacity_overflow_rows: number;
  curtailment_known_rows: number;
};

export async function loadRealForecastDataReadiness() {
  try {
    const [scadaSource, turbines, observations, signals, nwpSource, points, pairs, pairTimes] = await Promise.all([
      queryDatabase<SourceRow>(
        "SELECT import_status,entity_id FROM website_data.forecast_scada_sources WHERE source_id=$1",
        [SCADA_SOURCE_ID],
      ),
      queryDatabase<TurbineStatsRow>(
        `SELECT count(*)::int AS turbines,
                count(*) FILTER (WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)::int AS valid_coordinates,
                sum(rated_power_kw)/1000.0 AS installed_capacity_mw
         FROM website_data.forecast_scada_turbines
         WHERE source_id=$1`,
        [SCADA_SOURCE_ID],
      ),
      queryDatabase<ObservationStatsRow>(
        `WITH hourly AS (
           SELECT date_trunc('hour', observed_at - interval '1 second') + interval '1 hour' AS hour_end,
                  count(*) AS samples,
                  bool_or(active_power_mw IS NULL OR active_power_mw < 0) AS invalid_power
           FROM website_data.forecast_scada_observations
           WHERE source_id=$1
           GROUP BY 1
         )
         SELECT count(*)::int AS rows,
                min(observed_at)::text AS earliest_utc,
                max(observed_at)::text AS latest_utc,
                count(*) FILTER (WHERE active_power_mw IS NULL)::int AS missing_power_rows,
                count(*) FILTER (WHERE active_power_mw < 0)::int AS negative_rows,
                count(*) FILTER (WHERE quality_code='suspect')::int AS suspect_rows,
                (SELECT count(*)::int FROM hourly WHERE samples=6) AS complete_hourly_candidates,
                (SELECT count(*)::int FROM hourly WHERE samples=6 AND invalid_power) AS invalid_hourly_windows
         FROM website_data.forecast_scada_observations
         WHERE source_id=$1`,
        [SCADA_SOURCE_ID],
      ),
      queryDatabase<SignalStatsRow>(
        `SELECT count(*)::int AS rows,
                count(*) FILTER (WHERE quality_code='missing')::int AS missing_quality_rows,
                count(*) FILTER (WHERE power_reduced_flag)::int AS source_reduced_power_rows,
                count(*) FILTER (WHERE power_reduced_seconds > 0)::int AS source_reduced_power_seconds_rows,
                coalesce(sum(power_reduced_seconds),0)::real AS source_reduced_power_seconds
         FROM website_data.forecast_scada_turbine_signals
         WHERE source_id=$1`,
        [SCADA_SOURCE_ID],
      ),
      queryDatabase<SourceRow>(
        "SELECT import_status,entity_id FROM website_data.forecast_nwp_sources WHERE source_id=$1",
        [NWP_SOURCE_ID],
      ),
      queryDatabase<PointStatsRow>(
        `SELECT count(*)::int AS rows,
                count(*) FILTER (WHERE issue_time >= valid_time)::int AS future_issue_rows,
                count(*) FILTER (WHERE quality_code <> 'valid')::int AS non_valid_rows
         FROM website_data.forecast_nwp_points
         WHERE source_id=$1 AND entity_id=$2`,
        [NWP_SOURCE_ID, ENTITY_ID],
      ),
      queryDatabase<PairStatsRow>(
        `SELECT count(*)::int AS rows,
                min(observed_at)::text AS earliest_utc,
                max(observed_at)::text AS latest_utc,
                count(*) FILTER (WHERE nwp_issue_time >= nwp_valid_time)::int AS future_issue_rows,
                count(*) FILTER (WHERE nwp_valid_time <> observed_at)::int AS mismatched_valid_times,
                count(*) FILTER (WHERE available_capacity_mw > installed_capacity_mw)::int AS capacity_overflow_rows,
                count(*) FILTER (WHERE curtailment_known)::int AS curtailment_known_rows
         FROM website_data.forecast_training_pairs
         WHERE entity_id=$1`,
        [ENTITY_ID],
      ),
      queryDatabase<{ observed_at: string }>(
        "SELECT observed_at::text FROM website_data.forecast_training_pairs WHERE entity_id=$1 ORDER BY observed_at",
        [ENTITY_ID],
      ),
    ]);

    const scadaSourceRow = scadaSource.rows[0];
    const turbineRow = turbines.rows[0] ?? { turbines: 0, valid_coordinates: 0, installed_capacity_mw: null };
    const observationRow = observations.rows[0] ?? {
      rows: 0,
      earliest_utc: null,
      latest_utc: null,
      missing_power_rows: 0,
      negative_rows: 0,
      suspect_rows: 0,
      complete_hourly_candidates: 0,
      invalid_hourly_windows: 0,
    };
    const signalRow = signals.rows[0] ?? {
      rows: 0,
      missing_quality_rows: 0,
      source_reduced_power_rows: 0,
      source_reduced_power_seconds_rows: 0,
      source_reduced_power_seconds: 0,
    };
    const nwpSourceRow = nwpSource.rows[0];
    const pointRow = points.rows[0] ?? { rows: 0, future_issue_rows: 0, non_valid_rows: 0 };
    const pairRow = pairs.rows[0] ?? {
      rows: 0,
      earliest_utc: null,
      latest_utc: null,
      future_issue_rows: 0,
      mismatched_valid_times: 0,
      capacity_overflow_rows: 0,
      curtailment_known_rows: 0,
    };

    if (!scadaSourceRow || !nwpSourceRow) {
      return buildUnavailableRealDataEvidence("服务器预测数据源登记不完整，无法关闭真实数据门禁。");
    }

    return buildRealDataReadiness({
      scada: {
        sourceStatus: scadaSourceRow.import_status,
        entityId: scadaSourceRow.entity_id,
        turbineCount: Number(turbineRow.turbines),
        validCoordinateCount: Number(turbineRow.valid_coordinates),
        installedCapacityMw: turbineRow.installed_capacity_mw === null ? null : Number(turbineRow.installed_capacity_mw),
        observationRows: Number(observationRow.rows),
        observationStartUtc: observationRow.earliest_utc,
        observationEndUtc: observationRow.latest_utc,
        missingPowerRows: Number(observationRow.missing_power_rows),
        negativeObservationRows: Number(observationRow.negative_rows),
        suspectObservationRows: Number(observationRow.suspect_rows),
        completeHourlyCandidates: Number(observationRow.complete_hourly_candidates),
        invalidHourlyWindows: Number(observationRow.invalid_hourly_windows),
        signalRows: Number(signalRow.rows),
        missingSignalQualityRows: Number(signalRow.missing_quality_rows),
        sourceReducedPowerRows: Number(signalRow.source_reduced_power_rows),
        sourceReducedPowerSecondsRows: Number(signalRow.source_reduced_power_seconds_rows),
        sourceReducedPowerSeconds: Number(signalRow.source_reduced_power_seconds ?? 0),
      },
      nwp: {
        sourceStatus: nwpSourceRow.import_status,
        pointRows: Number(pointRow.rows),
        futureIssueRows: Number(pointRow.future_issue_rows),
        nonValidRows: Number(pointRow.non_valid_rows),
        pairRows: Number(pairRow.rows),
        pairStartUtc: pairRow.earliest_utc,
        pairEndUtc: pairRow.latest_utc,
        futurePairRows: Number(pairRow.future_issue_rows),
        mismatchedValidTimes: Number(pairRow.mismatched_valid_times),
        capacityOverflowRows: Number(pairRow.capacity_overflow_rows),
        curtailmentKnownRows: Number(pairRow.curtailment_known_rows),
      },
      pairTimes: pairTimes.rows.map((row) => row.observed_at),
    });
  } catch (error) {
    console.error("Real forecast data readiness query failed.", error);
    return buildUnavailableRealDataEvidence("服务器预测数据质量证据当前无法现场核验，生产预测保持锁定。");
  }
}
