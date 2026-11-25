\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_database() <> 'zyz' THEN
    RAISE EXCEPTION 'Connect to the zyz database before importing V11 supplemental data';
  END IF;
END;
$$;

SET LOCAL ROLE green_ddl;

SELECT pg_advisory_xact_lock(hashtextextended('opengridworks:v11:supplemental-ingest', 0));

CREATE TABLE IF NOT EXISTS catalog.supplemental_source (
  source_sha256 text PRIMARY KEY CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  dataset_id text NOT NULL,
  source_version text NOT NULL,
  title text NOT NULL,
  topics text[] NOT NULL CHECK (cardinality(topics) > 0 AND topics <@ ARRAY['meteo','power','carbon','economy']),
  source_url text NOT NULL,
  license_note text NOT NULL,
  expected_rows integer NOT NULL CHECK (expected_rows > 0),
  semantics jsonb NOT NULL CHECK (jsonb_typeof(semantics) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS standard.supplemental_city_power (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  city_code text NOT NULL CHECK (city_code ~ '^[0-9]{6}$'),
  city_name text NOT NULL CHECK (city_name <> ''),
  year smallint NOT NULL CHECK (year BETWEEN 2000 AND 2019),
  generation_100m_kwh numeric CHECK (generation_100m_kwh >= 0),
  emissions_10kt_co2 numeric CHECK (emissions_10kt_co2 >= 0),
  workbook_row integer NOT NULL CHECK (workbook_row >= 2),
  PRIMARY KEY (source_sha256, city_code, year),
  UNIQUE (source_sha256, workbook_row)
);

CREATE TABLE IF NOT EXISTS standard.supplemental_policy_counts (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  admin_level text NOT NULL CHECK (admin_level IN ('national','provincial','prefecture')),
  region_code text NOT NULL CHECK (region_code ~ '^[0-9]{6}$'),
  region_name text NOT NULL CHECK (region_name <> ''),
  effective_year smallint NOT NULL CHECK (effective_year BETWEEN 2000 AND 2025),
  label_code text NOT NULL CHECK (label_code ~ '^[a-z_]+$'),
  label_count integer CHECK (label_count >= 0),
  PRIMARY KEY (source_sha256, admin_level, region_code, effective_year, label_code)
);

CREATE TABLE IF NOT EXISTS standard.supplemental_renewable_feature (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  feature_id bigint NOT NULL CHECK (feature_id > 0),
  technology text NOT NULL CHECK (technology IN ('wind','solar')),
  detected_year smallint NOT NULL CHECK (detected_year BETWEEN 2017 AND 2024),
  detected_quarter smallint NOT NULL CHECK (detected_quarter BETWEEN 1 AND 4),
  country_source text,
  landcover_2018 text,
  geometry_wkb bytea NOT NULL CHECK (octet_length(geometry_wkb) > 5),
  srid integer NOT NULL CHECK (srid = 3857),
  geometry_is_empty boolean NOT NULL,
  source_attributes jsonb NOT NULL CHECK (jsonb_typeof(source_attributes) = 'object'),
  PRIMARY KEY (source_sha256, feature_id),
  CHECK ((detected_year, detected_quarter) BETWEEN (2017, 4) AND (2024, 2))
);

CREATE OR REPLACE VIEW semantic.supplemental_dataset_catalog AS
SELECT topic.topic_id, source.dataset_id, source.source_version, source.title,
       source.source_url, source.license_note, source.source_sha256, source.expected_rows AS row_count,
       source.semantics, 'draft'::text AS review_status, source.imported_at
FROM catalog.supplemental_source source
CROSS JOIN LATERAL unnest(source.topics) AS topic(topic_id);

COMMENT ON VIEW semantic.supplemental_dataset_catalog IS '经源文件校验的补充数据目录。数据仍待 V11 问数发布。';
COMMENT ON COLUMN standard.supplemental_renewable_feature.geometry_wkb IS '源 GeoPackage 几何的标准 WKB。使用 srid 指定的 CRS 转为 PostGIS geometry。';
GRANT USAGE ON SCHEMA semantic TO green_agent_ro;
GRANT SELECT ON semantic.supplemental_dataset_catalog TO green_agent_ro;

CREATE TEMP TABLE incoming_source (LIKE catalog.supplemental_source INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_city (LIKE standard.supplemental_city_power INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_policy (LIKE standard.supplemental_policy_counts INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_feature (LIKE standard.supplemental_renewable_feature INCLUDING ALL) ON COMMIT DROP;

\copy pg_temp.incoming_source (source_sha256,dataset_id,source_version,title,topics,source_url,license_note,expected_rows,semantics) FROM 'source.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_city FROM 'city.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_policy FROM 'policy.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_feature FROM 'feature.csv' WITH (FORMAT csv)

INSERT INTO catalog.supplemental_source SELECT * FROM pg_temp.incoming_source ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_city_power SELECT * FROM pg_temp.incoming_city ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_policy_counts SELECT * FROM pg_temp.incoming_policy ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_renewable_feature SELECT * FROM pg_temp.incoming_feature ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_temp.incoming_source AS source
    CROSS JOIN LATERAL (
      SELECT sum(row_count) AS count FROM (
        SELECT count(*) AS row_count FROM standard.supplemental_city_power WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_policy_counts WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_renewable_feature WHERE source_sha256 = source.source_sha256
      ) AS counts
    ) AS actual
    WHERE actual.count <> source.expected_rows
  ) THEN
    RAISE EXCEPTION 'Supplemental file row counts do not match their catalog entries';
  END IF;
END;
$$;

SELECT dataset_id, source_version, expected_rows AS imported_rows, source_sha256
FROM pg_temp.incoming_source ORDER BY dataset_id, source_sha256;
COMMIT;
