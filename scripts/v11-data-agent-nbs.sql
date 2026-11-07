BEGIN;
SET LOCAL ROLE green_ddl;
SET LOCAL search_path = pg_catalog;

CREATE TABLE IF NOT EXISTS staging.nbs_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.stats\.gov\.cn/sj/zxfb/[0-9]{6}/t[0-9]{8}_[0-9]+\.html$'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_html text NOT NULL CHECK (octet_length(source_html) BETWEEN 1 AND 2000000),
  observations jsonb NOT NULL CHECK (jsonb_typeof(observations) = 'array'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  version text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  review_note text,
  UNIQUE (source_url, source_sha256),
  CHECK (period_month = date_trunc('month', period_month)::date)
);

CREATE OR REPLACE VIEW staging.nbs_release_facts AS
SELECT b.id AS batch_id, b.status, b.reviewed_at, 'power'::text AS topic_id, 'power_nbs_monthly'::text AS dataset_id,
       f.metric_code, '000000000000'::text AS entity_code, f.series_code,
       b.period_month::timestamp AT TIME ZONE 'UTC' AS time_start, NULL::timestamptz AS issue_time, f.value,
       jsonb_build_object('url', b.source_url, 'scope', 'national', 'region_name', '全国',
                          'product_name', f.product_name, 'reporting_month', to_char(b.period_month, 'YYYY-MM'),
                          'release_sha256', b.source_sha256) AS source_ref
FROM staging.nbs_release b
CROSS JOIN LATERAL jsonb_to_recordset(b.observations) AS f(metric_code text, series_code text, value numeric, product_name text);

CREATE OR REPLACE FUNCTION catalog.publish_nbs_release(batch uuid, note text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
  release staging.nbs_release%ROWTYPE;
  base catalog.dataset_version%ROWTYPE;
  next_version text;
  version_id bigint;
  expected_rows integer;
  inserted_rows integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('opengridworks:v11:data-agent-publication', 0));
  SELECT * INTO STRICT release FROM staging.nbs_release WHERE id = batch FOR UPDATE;
  IF release.status = 'published' THEN RETURN release.version; END IF;
  IF release.status <> 'pending' OR release.issues <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Batch is ineligible for publication' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT FROM staging.nbs_release r
    WHERE r.period_month = release.period_month AND r.status = 'published' AND r.submitted_at > release.submitted_at
  ) THEN
    RAISE EXCEPTION 'A more recent batch for this period was already published' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO STRICT base FROM catalog.dataset_version
  WHERE dataset_id = 'power_nbs_monthly' AND is_current FOR UPDATE;

  -- The current approved snapshot defines every series the updater can write.
  IF EXISTS (
    SELECT FROM staging.nbs_release_facts f
    LEFT JOIN semantic.sem_metric m ON m.dataset_id = f.dataset_id AND m.metric_code = f.metric_code
      AND m.review_status = 'approved'
    WHERE f.batch_id = batch AND (m.metric_code IS NULL
      OR NOT COALESCE((base.metrics_snapshot->f.metric_code->'series_codes') ? f.series_code, false))
  ) THEN
    RAISE EXCEPTION 'Batch contains unapproved metrics or series' USING ERRCODE = '22023';
  END IF;

  WITH incoming AS MATERIALIZED (
    SELECT topic_id, dataset_id, metric_code, entity_code, series_code, time_start, issue_time, value, source_ref
    FROM staging.nbs_release_facts WHERE batch_id = batch
  ), new_facts AS (
    SELECT encode(sha256(convert_to(to_jsonb(i)::text, 'UTF8')), 'hex') AS hash FROM incoming i
    UNION ALL
    SELECT f.source_row_hash FROM standard.std_data_agent_fact f
    WHERE f.topic_id = 'power' AND f.dataset_version_id = base.id AND NOT EXISTS (
      SELECT FROM incoming i WHERE (i.metric_code, i.entity_code, i.series_code, i.time_start) =
                                  (f.metric_code, f.entity_code, f.series_code, f.time_start)
    )
  )
  SELECT count(*)::integer, encode(sha256(convert_to(base.metrics_snapshot::text || string_agg(hash, '' ORDER BY hash), 'UTF8')), 'hex')
  INTO expected_rows, next_version FROM new_facts;

  INSERT INTO catalog.dataset_version (topic_id, dataset_id, version, row_count, metric_snapshot, metrics_snapshot)
  VALUES (base.topic_id, base.dataset_id, next_version, expected_rows, base.metric_snapshot, base.metrics_snapshot)
  ON CONFLICT (dataset_id, version) DO NOTHING;
  SELECT id INTO STRICT version_id FROM catalog.dataset_version WHERE dataset_id = base.dataset_id AND version = next_version;

  WITH incoming AS MATERIALIZED (
    SELECT topic_id, dataset_id, metric_code, entity_code, series_code, time_start, issue_time, value, source_ref
    FROM staging.nbs_release_facts WHERE batch_id = batch
  )
  INSERT INTO standard.std_data_agent_fact (topic_id, dataset_id, dataset_version_id, metric_code, entity_code, series_code,
    time_start, issue_time, value, quality_flag, source_ref, source_row_hash)
  SELECT i.topic_id, i.dataset_id, version_id, i.metric_code, i.entity_code, i.series_code, i.time_start, i.issue_time,
    i.value, CASE WHEN i.value IS NULL THEN 1 ELSE 0 END, i.source_ref, encode(sha256(convert_to(to_jsonb(i)::text, 'UTF8')), 'hex')
  FROM incoming i
  UNION ALL
  SELECT f.topic_id, f.dataset_id, version_id, f.metric_code, f.entity_code, f.series_code, f.time_start, f.issue_time,
    f.value, f.quality_flag, f.source_ref, f.source_row_hash
  FROM standard.std_data_agent_fact f
  WHERE f.topic_id = 'power' AND f.dataset_version_id = base.id AND NOT EXISTS (
    SELECT FROM incoming i WHERE (i.metric_code, i.entity_code, i.series_code, i.time_start) =
                                (f.metric_code, f.entity_code, f.series_code, f.time_start)
  )
  ON CONFLICT (topic_id, dataset_version_id, source_row_hash) DO NOTHING;

  SELECT count(*)::integer INTO inserted_rows FROM standard.std_data_agent_fact
  WHERE topic_id = 'power' AND dataset_version_id = version_id;
  IF inserted_rows <> expected_rows THEN RAISE EXCEPTION 'Published batch row count mismatch'; END IF;
  IF version_id <> base.id THEN
    UPDATE catalog.dataset_version SET is_current = false WHERE id = base.id;
    UPDATE catalog.dataset_version SET is_current = true WHERE id = version_id;
  END IF;
  UPDATE staging.nbs_release
    SET status = 'published', version = next_version, reviewed_at = now(), review_note = note WHERE id = batch;
  RETURN next_version;
END
$$;

CREATE OR REPLACE FUNCTION staging.submit_nbs_release(
  period date, url text, html text, observations jsonb, issues jsonb
)
RETURNS TABLE(id uuid, status text, version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
  batch uuid;
  invalid boolean;
  needs_review boolean;
  unusual boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('opengridworks:v11:data-agent-publication', 0));
  SELECT count(*) <> 13 OR count(DISTINCT (o.metric_code, o.series_code)) <> 13
      OR COALESCE(bool_or(o.metric_code IS NULL OR o.series_code IS NULL OR o.product_name IS NULL OR o.value IS NULL
        OR o.value::text IN ('NaN', 'Infinity', '-Infinity')
        OR CASE WHEN o.metric_code IN ('electricity_generation_yoy','electricity_generation_cumulative_yoy')
                THEN o.value < -100 OR o.value > 1000 ELSE o.value < 0 OR o.value > 1000000 END), false)
  INTO invalid
  FROM jsonb_to_recordset(observations) AS o(metric_code text, series_code text, product_name text, value numeric);
  IF invalid THEN issues := issues || jsonb_build_array('缺少预期的 13 项观测，或存在重复、空值或异常数值'); END IF;
  SELECT r.id INTO batch FROM staging.nbs_release r WHERE r.period_month = period AND r.source_url = url
    AND r.observations = submit_nbs_release.observations AND r.issues = submit_nbs_release.issues
    ORDER BY r.submitted_at DESC LIMIT 1;
  IF batch IS NOT NULL THEN
    RETURN QUERY SELECT r.id, r.status, r.version FROM staging.nbs_release r WHERE r.id = batch;
    RETURN;
  END IF;
  INSERT INTO staging.nbs_release AS r (period_month, source_url, source_sha256, source_html, observations, issues)
  VALUES (period, url, encode(sha256(convert_to(html, 'UTF8')), 'hex'), html, observations, issues)
  ON CONFLICT (source_url, source_sha256) DO NOTHING RETURNING r.id INTO batch;

  IF batch IS NULL THEN
    RETURN QUERY SELECT r.id, r.status, r.version FROM staging.nbs_release r
    WHERE r.source_url = url AND r.source_sha256 = encode(sha256(convert_to(html, 'UTF8')), 'hex');
    RETURN;
  END IF;
  SELECT EXISTS (
    SELECT FROM catalog.dataset_version v
    JOIN standard.std_data_agent_fact f ON f.topic_id = 'power' AND f.dataset_version_id = v.id
    WHERE v.dataset_id = 'power_nbs_monthly' AND v.is_current AND f.entity_code = '000000000000'
      AND f.time_start = period::timestamptz
  ) INTO needs_review;
  SELECT EXISTS (
    SELECT FROM staging.nbs_release_facts i
    JOIN catalog.dataset_version v ON v.dataset_id = i.dataset_id AND v.is_current
    JOIN standard.std_data_agent_fact f ON f.topic_id = 'power' AND f.dataset_version_id = v.id
      AND (f.metric_code, f.entity_code, f.series_code, f.time_start) =
          (i.metric_code, i.entity_code, i.series_code, i.time_start - interval '1 year')
    WHERE i.batch_id = batch AND CASE
      WHEN i.metric_code IN ('electricity_generation_yoy', 'electricity_generation_cumulative_yoy')
        THEN abs(i.value - f.value) > 80
      WHEN f.value > 0 THEN i.value > f.value * 4 OR i.value < f.value / 4
      ELSE false
    END
  ) INTO unusual;
  IF issues = '[]'::jsonb AND NOT needs_review AND NOT unusual THEN
    PERFORM catalog.publish_nbs_release(batch, '国家统计局已配置来源，新增报告期通过校验后自动发布');
  ELSIF needs_review THEN
    UPDATE staging.nbs_release SET review_note = '该报告期已有全国数据，请对照来源复核修订。' WHERE nbs_release.id = batch;
  ELSIF unusual THEN
    UPDATE staging.nbs_release SET review_note = '部分观测与上年同月差异较大，请对照来源复核。' WHERE nbs_release.id = batch;
  END IF;
  RETURN QUERY SELECT r.id, r.status, r.version FROM staging.nbs_release r WHERE r.id = batch;
END
$$;

CREATE OR REPLACE FUNCTION staging.review_nbs_release(batch uuid, approve boolean, note text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF approve THEN
    PERFORM catalog.publish_nbs_release(batch, note);
    RETURN true;
  END IF;
  UPDATE staging.nbs_release SET status = 'rejected', reviewed_at = now(), review_note = note
  WHERE id = batch AND status = 'pending';
  RETURN FOUND;
END
$$;

CREATE OR REPLACE VIEW staging.nbs_release_review AS
SELECT r.id, r.period_month, r.source_url, r.source_sha256, r.observations, r.issues, r.status, r.version,
  r.submitted_at, r.reviewed_at, r.review_note,
  CASE WHEN r.status = 'pending' THEN (
    SELECT jsonb_object_agg(i.metric_code || ':' || i.series_code, f.value::text)
    FROM staging.nbs_release_facts i
    JOIN catalog.dataset_version v ON v.dataset_id = i.dataset_id AND v.is_current
    JOIN standard.std_data_agent_fact f ON f.topic_id = 'power' AND f.dataset_version_id = v.id
      AND (f.metric_code, f.entity_code, f.series_code, f.time_start) =
          (i.metric_code, i.entity_code, i.series_code, i.time_start)
    WHERE i.batch_id = r.id
  ) END AS current_values
FROM staging.nbs_release r;

REVOKE ALL ON FUNCTION catalog.publish_nbs_release(uuid, text), staging.submit_nbs_release(date, text, text, jsonb, jsonb),
  staging.review_nbs_release(uuid, boolean, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA staging TO green_agent_ingest, green_agent_review;
GRANT EXECUTE ON FUNCTION staging.submit_nbs_release(date, text, text, jsonb, jsonb) TO green_agent_ingest;
GRANT SELECT ON staging.nbs_release_review TO green_agent_review;
GRANT EXECUTE ON FUNCTION staging.review_nbs_release(uuid, boolean, text) TO green_agent_review;
GRANT SELECT ON staging.nbs_release_facts TO zyz;

COMMIT;
