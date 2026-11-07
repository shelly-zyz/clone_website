BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL timezone = 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF current_database() <> 'zyz' OR current_user <> 'zyz' THEN
    RAISE EXCEPTION 'Run publication as zyz in the zyz database';
  END IF;
END;
$$;

SELECT pg_advisory_xact_lock(hashtextextended('opengridworks:v11:data-agent-publication', 0));

INSERT INTO semantic.sem_metric
  (dataset_id, topic_id, metric_code, name, unit, time_grain, data_identity, source_name, definition, review_status)
VALUES
  ('meteo_gfs_forecast', 'meteo', 'grid_temperature_mean', 'GFS 全球气温格点平均值', '°C', 'forecast_frame',
   'forecast', 'NOAA GFS', '已入库预报帧的格点算术均值。按起报分组，横轴为有效时刻。该值没有按格点面积加权。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_wind_speed_10m_mean', 'GFS 全球 10 米风速格点平均值', 'm/s', 'forecast_frame',
   'forecast', 'NOAA GFS', '距地面 10 米的风矢量先逐格点取模，再算术平均。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_wind_speed_100m_mean', 'GFS 全球 100 米风速格点平均值', 'm/s', 'forecast_frame',
   'forecast', 'NOAA GFS', '距地面 100 米的风矢量先逐格点取模，再算术平均。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_surface_wind_gust_mean', 'GFS 全球地面阵风格点平均值', 'm/s', 'forecast_frame',
   'forecast', 'NOAA GFS', '地面阵风字段的格点算术均值。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_relative_humidity_2m_mean', 'GFS 全球 2 米相对湿度格点平均值', '%', 'forecast_frame',
   'forecast', 'NOAA GFS', '距地面 2 米的相对湿度格点算术均值。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_specific_humidity_2m_mean', 'GFS 全球 2 米比湿格点平均值', 'kg/kg', 'forecast_frame',
   'forecast', 'NOAA GFS', '距地面 2 米的比湿格点算术均值。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_mean_sea_level_pressure_mean', 'GFS 全球海平面气压格点平均值', 'hPa', 'forecast_frame',
   'forecast', 'NOAA GFS', '折算到平均海平面的气压格点算术均值。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_surface_pressure_mean', 'GFS 全球地面气压格点平均值', 'hPa', 'forecast_frame',
   'forecast', 'NOAA GFS', '地面气压字段的格点算术均值。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_precipitable_water_mean', 'GFS 全球大气柱可降水量格点平均值', 'kg/m²', 'forecast_frame',
   'forecast', 'NOAA GFS', '整层大气柱可降水量的格点算术均值。', 'approved'),
  ('meteo_gfs_forecast', 'meteo', 'grid_surface_cape_mean', 'GFS 全球地面对流有效位能格点平均值', 'J/kg', 'forecast_frame',
   'forecast', 'NOAA GFS', '地面起算的对流有效位能字段的格点算术均值。', 'approved'),
  ('power_nbs_monthly', 'power', 'electricity_generation_current', '发电量本期值', '亿千瓦时', 'month',
   'official_statistics', '国家统计局国家数据', '直接返回发布期内的原值。1—2 月缺测保持 NULL，不拆分或推算。全国与省份、总量与分电源系列分别查询。', 'approved'),
  ('power_nbs_monthly', 'power', 'electricity_generation_cumulative', '发电量累计值', '亿千瓦时', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的年初至本月累计总发电量，保留缺测。', 'approved'),
  ('power_nbs_monthly', 'power', 'electricity_generation_yoy', '发电量本期同比增长', '%', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的总发电量本期同比增长率，保留缺测。', 'approved'),
  ('power_nbs_monthly', 'power', 'electricity_generation_cumulative_yoy', '发电量累计同比增长', '%', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的总发电量年初至本月累计同比增长率，保留缺测。', 'approved'),
  ('power_nbs_monthly', 'power', 'raw_coal_production_current', '原煤产量本期值', '万吨', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的原煤本期产量，保留缺测。', 'approved'),
  ('power_nbs_monthly', 'power', 'crude_oil_production_current', '原油产量本期值', '万吨', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的原油本期产量，保留缺测。', 'approved'),
  ('power_nbs_monthly', 'power', 'crude_oil_processing_current', '原油加工量本期值', '万吨', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的本期原油加工量，保留缺测。', 'approved'),
  ('power_nbs_monthly', 'power', 'natural_gas_production_current', '天然气产量本期值', '亿立方米', 'month',
   'official_statistics', '国家统计局国家数据', '来源发布的天然气本期产量，保留缺测。', 'approved'),
  ('carbon_graced_power', 'carbon', 'global_grid_emission_rate_sum', 'GRACED Power 全球日帧格点速率合计', 'kgC/h', 'day',
   'research_estimate', 'Carbon Monitor GRACED', '电力部门每日全球网格的排放速率合计。各日速率分别返回，不跨日直接求和。', 'approved'),
  ('carbon_graced_power', 'carbon', 'global_grid_nonzero_cell_count', 'GRACED Power 全球日帧非零格点数', '格点', 'day',
   'research_estimate', 'Carbon Monitor GRACED', '每日 Power 排放估算帧中值非零的格点数量。', 'approved'),
  ('carbon_graced_power', 'carbon', 'global_grid_total_cell_count', 'GRACED Power 全球日帧总格点数', '格点', 'day',
   'research_estimate', 'Carbon Monitor GRACED', '每日 Power 排放估算帧的网格宽度乘以高度，包含零值格点。', 'approved')
ON CONFLICT (dataset_id, metric_code) DO NOTHING;

CREATE TEMP TABLE data_agent_stage (
  topic_id text NOT NULL,
  dataset_id text NOT NULL,
  metric_code text NOT NULL,
  entity_code text NOT NULL,
  series_code text NOT NULL,
  time_start timestamptz NOT NULL,
  issue_time timestamptz,
  value numeric,
  source_ref jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO data_agent_stage
SELECT 'meteo', 'meteo_gfs_forecast', fields.metric_code, 'global', f.metric, valid_time_utc, run_time_utc,
       CASE WHEN jsonb_typeof(metadata #> '{stats,mean}') = 'number' THEN (metadata #>> '{stats,mean}')::numeric END,
       jsonb_build_object('source', source, 'lead_hours', forecast_hour, 'payload_sha256', payload_sha256, 'dx_degrees', dx, 'dy_degrees', dy)
       || CASE WHEN fields.level IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('level', fields.level) END
FROM weather.weather_forecast_fields f
JOIN (VALUES
  ('temperature', 'degC', NULL, 'grid_temperature_mean'),
  ('wind', 'm/s', '10 m above ground', 'grid_wind_speed_10m_mean'),
  ('wind100m', 'm/s', '100 m above ground', 'grid_wind_speed_100m_mean'),
  ('windGust', 'm/s', 'surface', 'grid_surface_wind_gust_mean'),
  ('relativeHumidity', '%', '2 m above ground', 'grid_relative_humidity_2m_mean'),
  ('specificHumidity', 'kg/kg', '2 m above ground', 'grid_specific_humidity_2m_mean'),
  ('mslp', 'hPa', 'mean sea level', 'grid_mean_sea_level_pressure_mean'),
  ('surfacePressure', 'hPa', 'surface', 'grid_surface_pressure_mean'),
  ('precipitableWater', 'kg/m2', 'entire atmosphere (single layer)', 'grid_precipitable_water_mean'),
  ('cape', 'J/kg', 'surface', 'grid_surface_cape_mean')
) AS fields(source_field, source_unit, level, metric_code)
  ON f.metric = fields.source_field AND f.unit = fields.source_unit
  AND (fields.level IS NULL OR f.metadata->>'nativeLevelLabel' = fields.level)
WHERE f.source = 'GFS';

INSERT INTO data_agent_stage
SELECT 'power', 'power_nbs_monthly', indicators.metric_code, region_code, product_code, period_month::timestamptz, NULL,
       value, jsonb_build_object('url', source_url, 'scope', scope, 'region_name', region_name,
                                'product_name', product_name, 'indicator_id', nbs_indicator_id, 'reporting_month', to_char(period_month, 'YYYY-MM'))
FROM website_data.nbs_energy_monthly f
JOIN (VALUES
  ('current', ARRAY['electricity', 'thermal-power', 'hydro-power', 'nuclear-power', 'wind-power', 'solar-power'], '亿千瓦时', 'electricity_generation_current'),
  ('cumulative', ARRAY['electricity'], '亿千瓦时', 'electricity_generation_cumulative'),
  ('yoy', ARRAY['electricity'], '%', 'electricity_generation_yoy'),
  ('cumulative-yoy', ARRAY['electricity'], '%', 'electricity_generation_cumulative_yoy'),
  ('current', ARRAY['raw-coal'], '万吨', 'raw_coal_production_current'),
  ('current', ARRAY['crude-oil'], '万吨', 'crude_oil_production_current'),
  ('current', ARRAY['crude-processing'], '万吨', 'crude_oil_processing_current'),
  ('current', ARRAY['natural-gas'], '亿立方米', 'natural_gas_production_current')
) AS indicators(source_metric, products, source_unit, metric_code)
  ON f.metric_code = indicators.source_metric AND f.product_code = ANY(indicators.products) AND f.unit = indicators.source_unit
WHERE f.scope IN ('national', 'province');

DO $$
BEGIN
  IF to_regclass('staging.nbs_release_facts') IS NOT NULL THEN
    -- A full rebuild retains releases published by the incremental updater.
    DELETE FROM data_agent_stage s
    USING staging.nbs_release_facts f
    WHERE f.status = 'published' AND (s.dataset_id, s.metric_code, s.entity_code, s.series_code, s.time_start) =
      (f.dataset_id, f.metric_code, f.entity_code, f.series_code, f.time_start);
    INSERT INTO data_agent_stage
    SELECT DISTINCT ON (f.metric_code, f.series_code, f.time_start)
      f.topic_id, f.dataset_id, f.metric_code, f.entity_code, f.series_code, f.time_start, f.issue_time, f.value, f.source_ref
    FROM staging.nbs_release_facts f WHERE f.status = 'published'
    ORDER BY f.metric_code, f.series_code, f.time_start, f.reviewed_at DESC, f.batch_id;
  END IF;
END;
$$;

INSERT INTO data_agent_stage
SELECT 'carbon', 'carbon_graced_power', metrics.metric_code, 'global', 'Power', f.observed_on::timestamptz, NULL,
       metrics.value, jsonb_build_object('url', a.source_url, 'archive_sha256', a.archive_sha256,
                                         'frame_sha256', f.frame_sha256, 'sector', f.sector)
FROM carbon.carbon_emission_frames f
JOIN carbon.carbon_source_archives a ON a.official_id = f.source_archive_id AND a.sector = f.sector
CROSS JOIN LATERAL (VALUES
  ('global_grid_emission_rate_sum', f.sum_kgc_per_hour::numeric),
  ('global_grid_nonzero_cell_count', CASE WHEN f.nonzero_count BETWEEN 0 AND f.width::bigint * f.height THEN f.nonzero_count::numeric END),
  ('global_grid_total_cell_count', CASE WHEN f.width > 0 AND f.height > 0 THEN f.width::numeric * f.height END)
) AS metrics(metric_code, value)
WHERE f.sector = 'Power' AND f.unit = 'kgC/h';

DO $$
BEGIN
  IF (SELECT count(DISTINCT dataset_id) FROM data_agent_stage) <> 3 THEN
    RAISE EXCEPTION 'Each of the three V11 adapters must publish a non-empty snapshot';
  END IF;
  IF EXISTS (SELECT FROM data_agent_stage WHERE value::text IN ('NaN', 'Infinity', '-Infinity')) THEN
    RAISE EXCEPTION 'Source contains non-finite numbers';
  END IF;
END;
$$;

CREATE TEMP TABLE data_agent_hashed ON COMMIT DROP AS
SELECT s.*, encode(sha256(convert_to(to_jsonb(s)::text, 'UTF8')), 'hex') AS source_row_hash
FROM data_agent_stage s
JOIN semantic.sem_metric m USING (topic_id, dataset_id, metric_code)
WHERE m.review_status = 'approved';

CREATE TEMP TABLE data_agent_versions ON COMMIT DROP AS
WITH metric_entries AS (
  SELECT h.topic_id, h.dataset_id, h.metric_code,
         to_jsonb(m) || jsonb_build_object('series_codes', array_agg(DISTINCT h.series_code ORDER BY h.series_code)) AS metadata
  FROM data_agent_hashed h
  JOIN semantic.sem_metric m USING (topic_id, dataset_id, metric_code)
  GROUP BY h.topic_id, h.dataset_id, h.metric_code, m
), snapshots AS (
  SELECT topic_id, dataset_id, jsonb_object_agg(metric_code, metadata) AS metrics_snapshot
  FROM metric_entries
  GROUP BY topic_id, dataset_id
), facts AS (
  SELECT topic_id, dataset_id, count(*)::integer AS row_count, string_agg(source_row_hash, '' ORDER BY source_row_hash) AS row_hashes
  FROM data_agent_hashed
  GROUP BY topic_id, dataset_id
)
SELECT s.topic_id, s.dataset_id, f.row_count, s.metrics_snapshot, s.metrics_snapshot->defaults.metric_code AS metric_snapshot,
       encode(sha256(convert_to(s.metrics_snapshot::text || f.row_hashes, 'UTF8')), 'hex') AS version
FROM snapshots s
JOIN facts f USING (topic_id, dataset_id)
JOIN (VALUES
  ('meteo_gfs_forecast', 'grid_temperature_mean'),
  ('power_nbs_monthly', 'electricity_generation_current'),
  ('carbon_graced_power', 'global_grid_emission_rate_sum')
) AS defaults(dataset_id, metric_code) USING (dataset_id);

DO $$
BEGIN
  IF (SELECT count(*) FROM data_agent_versions WHERE metric_snapshot IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'All three datasets require an approved default metric';
  END IF;
END;
$$;

INSERT INTO catalog.dataset_version (topic_id, dataset_id, version, row_count, metric_snapshot, metrics_snapshot)
SELECT topic_id, dataset_id, version, row_count, metric_snapshot, metrics_snapshot FROM data_agent_versions
ON CONFLICT (dataset_id, version) DO NOTHING;

INSERT INTO standard.std_data_agent_fact
  (topic_id, dataset_id, dataset_version_id, metric_code, entity_code, series_code, time_start,
   issue_time, value, quality_flag, source_ref, source_row_hash)
SELECT h.topic_id, h.dataset_id, v.id, h.metric_code, h.entity_code, h.series_code, h.time_start,
       h.issue_time, h.value, CASE WHEN h.value IS NULL THEN 1 ELSE 0 END, h.source_ref, h.source_row_hash
FROM data_agent_hashed h
JOIN data_agent_versions p USING (topic_id, dataset_id)
JOIN catalog.dataset_version v ON v.dataset_id = p.dataset_id AND v.version = p.version
ON CONFLICT (topic_id, dataset_version_id, source_row_hash) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM data_agent_versions p
    JOIN catalog.dataset_version v USING (dataset_id, version)
    LEFT JOIN standard.std_data_agent_fact f ON f.topic_id = p.topic_id AND f.dataset_version_id = v.id
    GROUP BY p.dataset_id, p.row_count HAVING count(f.source_row_hash) <> p.row_count
  ) THEN
    RAISE EXCEPTION 'Published snapshot row count differs from the staged version';
  END IF;
END;
$$;

UPDATE catalog.dataset_version v SET is_current = false
FROM data_agent_versions p WHERE v.dataset_id = p.dataset_id AND v.version <> p.version AND v.is_current;

UPDATE catalog.dataset_version v SET is_current = true
FROM data_agent_versions p WHERE v.dataset_id = p.dataset_id AND v.version = p.version AND NOT v.is_current;

COMMIT;
