-- Run after v11-data-agent-schema.sql with the V11 migration account.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE green_ddl;

CREATE TABLE IF NOT EXISTS staging.weather_model_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[0-9a-f]{64}$'),
  model text NOT NULL CHECK (model IN ('wrf', 'climax')),
  model_version text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 120),
  region_code text NOT NULL CHECK (region_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  region_name text NOT NULL CHECK (length(region_name) BETWEEN 1 AND 100),
  bounds jsonb NOT NULL CHECK (jsonb_typeof(bounds) = 'array' AND jsonb_array_length(bounds) = 4),
  issue_time timestamptz NOT NULL,
  source_uri text NOT NULL CHECK (source_uri ~ '^(https|s3)://[^?#[:space:]]+$' AND length(source_uri) <= 512),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_metadata jsonb NOT NULL CHECK (jsonb_typeof(file_metadata) = 'object'),
  points jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  review_note text,
  dataset_version_id bigint REFERENCES catalog.dataset_version(id)
);

CREATE INDEX IF NOT EXISTS weather_model_releases_idx
  ON staging.weather_model_batch (model, region_code, issue_time DESC, reviewed_at DESC)
  WHERE status = 'published';

CREATE OR REPLACE VIEW catalog.weather_model_releases AS
SELECT id, version, model, model_version, region_code, region_name, bounds, issue_time, source_uri,
  dataset_version_id, reviewed_at AS published_at
FROM staging.weather_model_batch
WHERE status = 'published';

CREATE OR REPLACE VIEW catalog.weather_file_inspections AS
SELECT id, version, model, model_version, region_code, region_name, bounds, issue_time, source_uri,
  file_sha256, file_metadata, status, submitted_at, reviewed_at
FROM staging.weather_model_batch;

CREATE OR REPLACE FUNCTION catalog.review_weather_model_batch(batch_id uuid, publish boolean, note text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  item staging.weather_model_batch%ROWTYPE;
  dataset text;
  metric text := 'grid_wind_speed_10m_mean';
  source text;
  definition text := '区域经纬度范围内，逐格计算 10 米水平风速后取格点算术平均；保留源缺测。';
  snapshot jsonb;
  new_id bigint;
  point_count integer;
BEGIN
  IF publish IS NULL OR note IS NULL OR length(btrim(note)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A review decision and note are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item FROM staging.weather_model_batch WHERE id = batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Weather batch does not exist' USING ERRCODE = '22023'; END IF;
  IF item.status = (CASE WHEN publish THEN 'published' ELSE 'rejected' END) THEN RETURN item.status; END IF;
  IF item.status <> 'pending' THEN
    RAISE EXCEPTION 'Weather batch was already reviewed' USING ERRCODE = '22023';
  END IF;
  IF NOT publish THEN
    UPDATE staging.weather_model_batch SET status = 'rejected', reviewed_at = now(), review_note = btrim(note)
      WHERE id = batch_id;
    RETURN 'rejected';
  END IF;

  -- Serialize publishing and validate region identity across both models.
  PERFORM pg_advisory_xact_lock(hashtext('opengridworks.weather_model_publish'));
  IF EXISTS (SELECT FROM catalog.weather_model_releases r
    WHERE r.region_code = item.region_code AND r.bounds <> item.bounds) THEN
    RAISE EXCEPTION 'The region code is already published with different bounds' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT FROM jsonb_to_recordset(item.points)
      AS p(valid_time timestamptz, value numeric, valid_cells integer, total_cells integer)
    WHERE p.valid_time IS NULL OR p.valid_time < item.issue_time OR NOT isfinite(p.valid_time)
      OR p.valid_cells IS NULL OR p.total_cells IS NULL OR p.total_cells < 1
      OR p.valid_cells NOT BETWEEN 0 AND p.total_cells OR (p.value IS NULL) <> (p.valid_cells = 0)
      OR p.value < 0 OR p.value >= 'Infinity'::numeric
  ) OR NOT EXISTS (
    SELECT FROM jsonb_to_recordset(item.points) AS p(value numeric) WHERE p.value IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid or fully missing forecast points' USING ERRCODE = '22023';
  END IF;

  dataset := 'meteo_' || item.model || '_forecast';
  source := CASE item.model WHEN 'wrf' THEN 'WRF' ELSE 'ClimaX' END;
  INSERT INTO semantic.sem_metric
    (topic_id, dataset_id, metric_code, name, unit, time_grain, data_identity, source_name, definition, review_status)
  VALUES ('meteo', dataset, metric, '区域 10 米风速', 'm/s', 'forecast_frame', 'forecast', source, definition, 'approved')
  ON CONFLICT (dataset_id, metric_code) DO NOTHING;
  IF NOT EXISTS (SELECT FROM semantic.sem_metric m
    WHERE m.dataset_id = dataset AND m.metric_code = metric AND m.review_status = 'approved') THEN
    RAISE EXCEPTION 'Weather metric is not approved' USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(m) - 'topic_id' - 'dataset_id' || jsonb_build_object('series_codes', jsonb_build_array('wind'))
    INTO snapshot FROM semantic.sem_metric m WHERE m.dataset_id = dataset AND m.metric_code = metric;
  point_count := jsonb_array_length(item.points);
  UPDATE catalog.dataset_version SET is_current = false WHERE dataset_id = dataset AND is_current;
  INSERT INTO catalog.dataset_version (topic_id, dataset_id, version, is_current, row_count, metric_snapshot, metrics_snapshot)
  VALUES ('meteo', dataset, item.version, true, point_count, snapshot, jsonb_build_object(metric, snapshot))
  RETURNING id INTO new_id;

  INSERT INTO standard.std_data_agent_fact
    (topic_id, dataset_id, dataset_version_id, metric_code, entity_code, series_code, time_start, issue_time,
      value, quality_flag, source_ref, source_row_hash)
  SELECT 'meteo', dataset, new_id, metric, item.region_code, 'wind', p.valid_time, item.issue_time,
    p.value, CASE WHEN p.value IS NULL THEN 1 ELSE 0 END,
    jsonb_build_object('source_uri', item.source_uri, 'file_sha256', item.file_sha256, 'model_version', item.model_version,
      'region_name', item.region_name, 'valid_cells', p.valid_cells, 'total_cells', p.total_cells),
    encode(sha256(convert_to(item.version || '|' || extract(epoch FROM p.valid_time)::text, 'UTF8')), 'hex')
  FROM jsonb_to_recordset(item.points)
    AS p(valid_time timestamptz, value numeric, valid_cells integer, total_cells integer);

  UPDATE staging.weather_model_batch SET dataset_version_id = new_id, status = 'published',
    reviewed_at = now(), review_note = btrim(note) WHERE id = batch_id;
  RETURN 'published';
END;
$$;

REVOKE ALL ON FUNCTION catalog.review_weather_model_batch(uuid, boolean, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA catalog TO green_agent_ro, green_agent_review;
GRANT USAGE ON SCHEMA staging TO green_agent_ingest;
GRANT SELECT ON catalog.weather_model_releases, catalog.weather_file_inspections TO green_agent_ro;
GRANT SELECT (id, version, status), INSERT (version, model, model_version, region_code, region_name, bounds,
  issue_time, source_uri, file_sha256, file_metadata, points) ON staging.weather_model_batch TO green_agent_ingest;
GRANT EXECUTE ON FUNCTION catalog.review_weather_model_batch(uuid, boolean, text) TO green_agent_review;
COMMIT;
