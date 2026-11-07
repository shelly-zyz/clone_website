BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_database() <> 'zyz' OR current_user <> 'zyz' THEN
    RAISE EXCEPTION 'Run this migration as zyz in the zyz database';
  END IF;
END;
$$;

SET LOCAL ROLE green_ddl;

CREATE TABLE IF NOT EXISTS catalog.dataset_version (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_id text NOT NULL CHECK (topic_id IN ('meteo', 'power', 'carbon')),
  dataset_id text NOT NULL,
  version text NOT NULL CHECK (version ~ '^[0-9a-f]{64}$'),
  is_current boolean NOT NULL DEFAULT false,
  row_count integer NOT NULL CHECK (row_count > 0),
  metric_snapshot jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version),
  UNIQUE (id, topic_id, dataset_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS dataset_version_current_idx
  ON catalog.dataset_version (dataset_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS semantic.sem_metric (
  dataset_id text NOT NULL,
  topic_id text NOT NULL CHECK (topic_id IN ('meteo', 'power', 'carbon')),
  metric_code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  time_grain text NOT NULL,
  data_identity text NOT NULL,
  source_name text NOT NULL,
  definition text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('approved', 'draft')),
  PRIMARY KEY (dataset_id, metric_code),
  UNIQUE (topic_id, dataset_id, metric_code)
);

CREATE TABLE IF NOT EXISTS standard.std_data_agent_fact (
  topic_id text NOT NULL,
  dataset_id text NOT NULL,
  dataset_version_id bigint NOT NULL,
  metric_code text NOT NULL,
  entity_code text NOT NULL,
  series_code text NOT NULL,
  time_start timestamptz NOT NULL,
  issue_time timestamptz,
  value numeric,
  quality_flag smallint NOT NULL CHECK (quality_flag IN (0, 1)),
  source_ref jsonb NOT NULL,
  source_row_hash text NOT NULL CHECK (source_row_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (topic_id, dataset_version_id, source_row_hash),
  UNIQUE NULLS NOT DISTINCT (topic_id, dataset_version_id, metric_code, entity_code, series_code, time_start, issue_time),
  FOREIGN KEY (dataset_version_id, topic_id, dataset_id) REFERENCES catalog.dataset_version (id, topic_id, dataset_id),
  FOREIGN KEY (topic_id, dataset_id, metric_code) REFERENCES semantic.sem_metric (topic_id, dataset_id, metric_code),
  CHECK ((value IS NULL) = (quality_flag = 1))
) PARTITION BY LIST (topic_id);

CREATE TABLE IF NOT EXISTS standard.std_data_agent_meteo PARTITION OF standard.std_data_agent_fact FOR VALUES IN ('meteo');
CREATE TABLE IF NOT EXISTS standard.std_data_agent_power PARTITION OF standard.std_data_agent_fact FOR VALUES IN ('power');
CREATE TABLE IF NOT EXISTS standard.std_data_agent_carbon PARTITION OF standard.std_data_agent_fact FOR VALUES IN ('carbon');

COMMENT ON TABLE catalog.dataset_version IS '数据库智能体可查询的专题发布版本，保留历史版本供结果复现';
COMMENT ON TABLE semantic.sem_metric IS '数据库智能体已登记的指标口径与来源';
COMMENT ON TABLE standard.std_data_agent_fact IS '按专题分区的版本化事实记录，仅存智能查询批准的字段';
COMMENT ON COLUMN standard.std_data_agent_fact.issue_time IS '预报起报时间，time_start 对预报表示有效时间';
COMMENT ON COLUMN standard.std_data_agent_fact.quality_flag IS '0 为来源提供有效值，1 为来源缺测';

GRANT USAGE ON SCHEMA catalog, semantic, standard TO green_agent_ro;
GRANT SELECT ON catalog.dataset_version, semantic.sem_metric, standard.std_data_agent_fact TO green_agent_ro;

COMMIT;
