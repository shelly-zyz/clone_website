-- Run through import-era5-history.mjs, which supplies the validated Shanghai input.
SELECT pg_advisory_xact_lock(hashtextextended('opengridworks:v11:data-agent-publication', 0));

CREATE TABLE IF NOT EXISTS catalog.era5_history_source (
  source_sha256 text PRIMARY KEY,
  payload bytea NOT NULL,
  manifest jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_sha256 = encode(sha256(payload),'hex'))
);
COMMENT ON TABLE catalog.era5_history_source IS 'ERA5 城市历史批次的原始响应与采集参数。业务查询只读标准指标。';

CREATE TEMP TABLE era5_source ON COMMIT DROP AS
SELECT encode(sha256(payload),'hex') AS digest, manifest, hours FROM era5_import;
INSERT INTO catalog.era5_history_source (source_sha256,payload,manifest)
SELECT encode(sha256(payload),'hex'),payload,manifest FROM era5_import
ON CONFLICT (source_sha256) DO NOTHING;

CREATE TEMP TABLE era5_metrics (
  position integer, metric_code text, name text, unit text, source_field text, definition text
) ON COMMIT DROP;
INSERT INTO era5_metrics VALUES
  (0,'era5_air_temperature_2m','ERA5 上海 2 米气温','°C','temperature_2m','ERA5 再分析格点的 2 米气温，按 UTC 小时时刻读取。'),
  (1,'era5_wind_speed_10m','ERA5 上海 10 米风速','m/s','wind_speed_10m','ERA5 再分析格点的 10 米风速，按 UTC 小时时刻读取。'),
  (2,'era5_precipitation_1h','ERA5 上海前一小时降水量','mm','precipitation','标记时刻之前一小时的降水累计量，含雨和雪的等效水深。样本按 UTC 标记。');

INSERT INTO semantic.sem_metric (topic_id,dataset_id,metric_code,name,unit,time_grain,data_identity,source_name,definition,review_status)
SELECT 'meteo','meteo_era5_city_history',metric_code,name,unit,'hour','reanalysis','Copernicus ERA5 · Open-Meteo 历史天气',definition,'approved'
FROM era5_metrics
ON CONFLICT (dataset_id,metric_code) DO UPDATE SET
  name=EXCLUDED.name,unit=EXCLUDED.unit,time_grain=EXCLUDED.time_grain,data_identity=EXCLUDED.data_identity,
  source_name=EXCLUDED.source_name,definition=EXCLUDED.definition,review_status=EXCLUDED.review_status;

CREATE TEMP TABLE era5_release ON COMMIT DROP AS
WITH snapshots AS (
  SELECT s.digest,s.manifest,jsonb_object_agg(m.metric_code,to_jsonb(m) ||
    jsonb_build_object('series_codes',ARRAY['hourly'],'rules',jsonb_build_object(
      'id',m.metric_code||'.v1','period','hourly_value','aggregation','published_values_only','missing','preserve_null',
      'forecast','unsupported','lineage','Copernicus ERA5 via Open-Meteo · '||d.source_field,
      'interpretation',m.definition),
      'coverage',jsonb_build_object('start',s.manifest->>'first','end',s.manifest->>'last',
        'location_code','shanghai','location_name','上海 Shanghai'))) AS metrics
  FROM era5_source s CROSS JOIN era5_metrics d
  JOIN semantic.sem_metric m ON m.dataset_id='meteo_era5_city_history' AND m.metric_code=d.metric_code
  GROUP BY s.digest,s.manifest
), versions AS (
  SELECT encode(sha256(convert_to(digest||manifest::text||metrics::text,'UTF8')),'hex') AS version,
    (manifest->>'count')::integer*(SELECT count(*)::integer FROM era5_metrics) AS row_count,metrics,manifest
  FROM snapshots
)
SELECT *,NOT EXISTS (SELECT FROM catalog.dataset_version v
  WHERE v.dataset_id='meteo_era5_city_history' AND v.version=versions.version) AS new_version
FROM versions;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM era5_release r CROSS JOIN catalog.dataset_version v
    WHERE r.new_version AND v.dataset_id='meteo_era5_city_history' AND v.is_current
      AND ((r.manifest->>'first')::timestamptz > (v.metric_snapshot #>> '{coverage,start}')::timestamptz
        OR (r.manifest->>'last')::timestamptz < (v.metric_snapshot #>> '{coverage,end}')::timestamptz)
  ) THEN RAISE EXCEPTION 'An ERA5 refresh must retain the published coverage'; END IF;
END
$$;

INSERT INTO catalog.dataset_version (topic_id,dataset_id,version,row_count,metric_snapshot,metrics_snapshot)
SELECT 'meteo','meteo_era5_city_history',version,row_count,metrics->'era5_air_temperature_2m',metrics FROM era5_release
ON CONFLICT (dataset_id,version) DO NOTHING;

INSERT INTO standard.std_data_agent_fact
  (topic_id,dataset_id,dataset_version_id,metric_code,entity_code,series_code,time_start,issue_time,
    value,quality_flag,source_ref,source_row_hash)
SELECT 'meteo',v.dataset_id,v.id,m.metric_code,'shanghai','hourly',h.time,NULL,
  (h.readings->>m.position)::numeric,CASE WHEN h.readings->>m.position IS NULL THEN 1 ELSE 0 END,
  jsonb_build_object('url',s.manifest->>'url','source_sha256',s.digest,'source_field',m.source_field,'region_name','上海 Shanghai',
    'grid_latitude',s.manifest->'grid_latitude','grid_longitude',s.manifest->'grid_longitude','timezone','UTC'),
  encode(sha256(convert_to(concat_ws('|',s.digest,m.metric_code,extract(epoch FROM h.time)),'UTF8')),'hex')
FROM era5_source s CROSS JOIN LATERAL jsonb_to_recordset(s.hours) AS h(time timestamptz,readings jsonb)
CROSS JOIN era5_metrics m CROSS JOIN era5_release r
JOIN catalog.dataset_version v ON v.dataset_id='meteo_era5_city_history' AND v.version=r.version
ON CONFLICT (topic_id,dataset_version_id,source_row_hash) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM era5_release r JOIN catalog.dataset_version v ON v.dataset_id='meteo_era5_city_history' AND v.version=r.version
    LEFT JOIN standard.std_data_agent_fact f ON f.topic_id='meteo' AND f.dataset_version_id=v.id
    GROUP BY v.id,r.row_count HAVING count(f.source_row_hash)<>r.row_count
  ) THEN RAISE EXCEPTION 'ERA5 fact count does not match the verified source'; END IF;
END
$$;

UPDATE catalog.dataset_version v SET is_current=false FROM era5_release r
WHERE r.new_version AND v.dataset_id='meteo_era5_city_history' AND v.version<>r.version AND v.is_current;
UPDATE catalog.dataset_version v SET is_current=true FROM era5_release r
WHERE r.new_version AND v.dataset_id='meteo_era5_city_history' AND v.version=r.version AND NOT v.is_current;
SELECT version,row_count,manifest->>'first' AS first_utc,manifest->>'last' AS last_utc FROM era5_release;
