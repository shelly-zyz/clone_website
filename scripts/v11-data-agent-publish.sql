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
  ('power_nbs_monthly', 'power', 'electricity_generation_current', '发电量本期值', '亿千瓦时', 'month',
   'official_statistics', '国家统计局国家数据', '直接返回发布期内的原值。1—2 月缺测保持 NULL，不拆分或推算。全国与省份、总量与分电源系列分别查询。', 'approved'),
  ('carbon_graced_power', 'carbon', 'global_grid_emission_rate_sum', 'GRACED Power 全球日帧格点速率合计', 'kgC/h', 'day',
   'research_estimate', 'Carbon Monitor GRACED', '电力部门每日全球网格的排放速率合计。各日速率分别返回，不跨日直接求和。', 'approved')
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
SELECT 'meteo', 'meteo_gfs_forecast', 'grid_temperature_mean', 'global', 'temperature', valid_time_utc, run_time_utc,
       CASE WHEN jsonb_typeof(metadata #> '{stats,mean}') = 'number' THEN (metadata #>> '{stats,mean}')::numeric END,
       jsonb_build_object('source', source, 'lead_hours', forecast_hour, 'payload_sha256', payload_sha256, 'dx_degrees', dx, 'dy_degrees', dy)
FROM weather.weather_forecast_fields
WHERE source = 'GFS' AND metric = 'temperature' AND unit = 'degC';

INSERT INTO data_agent_stage
SELECT 'power', 'power_nbs_monthly', 'electricity_generation_current', region_code, product_code, period_month::timestamptz, NULL,
       value, jsonb_build_object('url', source_url, 'scope', scope, 'region_name', region_name,
                                'product_name', product_name, 'indicator_id', nbs_indicator_id, 'reporting_month', to_char(period_month, 'YYYY-MM'))
FROM website_data.nbs_energy_monthly
WHERE metric_code = 'current' AND unit = '亿千瓦时' AND scope IN ('national', 'province')
  AND product_code IN ('electricity', 'thermal-power', 'hydro-power', 'nuclear-power', 'wind-power', 'solar-power');

INSERT INTO data_agent_stage
SELECT 'carbon', 'carbon_graced_power', 'global_grid_emission_rate_sum', 'global', 'Power', f.observed_on::timestamptz, NULL,
       f.sum_kgc_per_hour::numeric, jsonb_build_object('url', a.source_url, 'archive_sha256', a.archive_sha256,
                                                    'frame_sha256', f.frame_sha256, 'sector', f.sector)
FROM carbon.carbon_emission_frames f
JOIN carbon.carbon_source_archives a ON a.official_id = f.source_archive_id AND a.sector = f.sector
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
FROM data_agent_stage s;

CREATE TEMP TABLE data_agent_versions ON COMMIT DROP AS
SELECT h.topic_id, h.dataset_id, count(*)::integer AS row_count, to_jsonb(m) AS metric_snapshot,
       encode(sha256(convert_to(to_jsonb(m)::text || string_agg(h.source_row_hash, '' ORDER BY h.source_row_hash), 'UTF8')), 'hex') AS version
FROM data_agent_hashed h
JOIN semantic.sem_metric m USING (topic_id, dataset_id, metric_code)
WHERE m.review_status = 'approved'
GROUP BY h.topic_id, h.dataset_id, m;

DO $$
BEGIN
  IF (SELECT count(*) FROM data_agent_versions) <> 3 THEN
    RAISE EXCEPTION 'All three datasets require an approved semantic definition';
  END IF;
END;
$$;

INSERT INTO catalog.dataset_version (topic_id, dataset_id, version, row_count, metric_snapshot)
SELECT topic_id, dataset_id, version, row_count, metric_snapshot FROM data_agent_versions
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
