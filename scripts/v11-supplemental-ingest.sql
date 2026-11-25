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

CREATE TABLE IF NOT EXISTS standard.supplemental_policy_document (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  policy_gid text NOT NULL CHECK (policy_gid ~ '^[0-9a-f]+$'),
  title text NOT NULL CHECK (title <> ''),
  publication_date_source text,
  effective_date_source text,
  issuer text,
  metadata_variants jsonb NOT NULL CHECK (jsonb_typeof(metadata_variants) = 'array'),
  source_groups jsonb NOT NULL CHECK (jsonb_typeof(source_groups) = 'object'),
  classifications jsonb NOT NULL CHECK (jsonb_typeof(classifications) = 'object'),
  PRIMARY KEY (source_sha256, policy_gid)
);

CREATE TABLE IF NOT EXISTS standard.supplemental_wdi_emissions (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  indicator_code text NOT NULL CHECK (indicator_code IN ('EN.GHG.CO2.MT.CE.AR5','EN.GHG.ALL.MT.CE.AR5')),
  region_key text NOT NULL CHECK (region_key ~ '^[A-Z0-9]{2,3}$'),
  region_name text NOT NULL CHECK (region_name <> ''),
  region_type text NOT NULL CHECK (region_type IN ('economy','aggregate','unmapped')),
  year smallint NOT NULL CHECK (year BETWEEN 1970 AND 2024),
  value_mt_co2e numeric,
  source_status text,
  PRIMARY KEY (source_sha256, region_key, year)
);

CREATE TABLE IF NOT EXISTS standard.supplemental_wri_plant (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  plant_id text NOT NULL CHECK (plant_id <> ''),
  plant_name text NOT NULL CHECK (plant_name <> ''),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{3}$'),
  latitude numeric NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  capacity_mw numeric NOT NULL CHECK (capacity_mw >= 0),
  primary_fuel text NOT NULL CHECK (primary_fuel <> ''),
  source_attributes jsonb NOT NULL CHECK (jsonb_typeof(source_attributes) = 'object'),
  generation_by_year jsonb NOT NULL CHECK (jsonb_typeof(generation_by_year) = 'object'),
  PRIMARY KEY (source_sha256, plant_id)
);

CREATE TABLE IF NOT EXISTS standard.supplemental_ghcn_station (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  station_id text NOT NULL CHECK (station_id ~ '^CH[A-Z0-9]{9}$'),
  station_name text NOT NULL CHECK (station_name <> ''),
  latitude numeric NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  elevation_m numeric,
  PRIMARY KEY (source_sha256, station_id)
);

CREATE TABLE IF NOT EXISTS standard.supplemental_ghcn_daily (
  source_sha256 text NOT NULL,
  station_id text NOT NULL,
  observed_on date NOT NULL CHECK (observed_on >= DATE '2024-01-01' AND observed_on < DATE '2025-01-01'),
  element text NOT NULL CHECK (element IN ('TMAX','TMIN','PRCP','SNOW')),
  value_source integer,
  measurement_flag text,
  quality_flag text,
  source_flag text,
  local_observation_time text,
  PRIMARY KEY (source_sha256, station_id, observed_on, element),
  FOREIGN KEY (source_sha256, station_id) REFERENCES standard.supplemental_ghcn_station
);

CREATE TABLE IF NOT EXISTS standard.supplemental_atlas_trade (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  reporter_code text NOT NULL CHECK (reporter_code ~ '^[A-Z0-9]{3}$'),
  reporter_id integer NOT NULL,
  partner_code text CHECK (partner_code ~ '^[A-Z0-9]{3}$'),
  hs92_chapter text CHECK (hs92_chapter ~ '^[0-9]{2}$'),
  partner_or_product_id integer NOT NULL,
  year smallint NOT NULL CHECK (year BETWEEN 1995 AND 2024),
  export_usd numeric,
  import_usd numeric,
  global_market_share numeric,
  distance numeric,
  complexity_outlook_gain numeric,
  product_complexity_index numeric,
  UNIQUE NULLS NOT DISTINCT (source_sha256, reporter_code, year, partner_code, hs92_chapter),
  CHECK ((partner_code IS NULL) <> (hs92_chapter IS NULL))
);

CREATE TABLE IF NOT EXISTS standard.supplemental_raster_asset (
  source_sha256 text NOT NULL REFERENCES catalog.supplemental_source,
  year smallint NOT NULL CHECK (year BETWEEN 1992 AND 2019),
  archive_member text NOT NULL,
  geotiff_member text NOT NULL,
  member_size_bytes bigint NOT NULL CHECK (member_size_bytes > 0),
  member_sha256 text NOT NULL CHECK (member_sha256 ~ '^[0-9a-f]{64}$'),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  pixel_width_m numeric NOT NULL CHECK (pixel_width_m = 1000),
  pixel_height_m numeric NOT NULL CHECK (pixel_height_m = 1000),
  nodata double precision NOT NULL,
  projection_source text NOT NULL,
  archive_uri text CHECK (archive_uri IS NULL OR archive_uri ~ '^s3://raw/'),
  PRIMARY KEY (source_sha256, year),
  UNIQUE (source_sha256, archive_member)
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
CREATE TEMP TABLE incoming_policy_document (LIKE standard.supplemental_policy_document INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_wdi (LIKE standard.supplemental_wdi_emissions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_wri (LIKE standard.supplemental_wri_plant INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_ghcn_station (LIKE standard.supplemental_ghcn_station INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_ghcn_daily (LIKE standard.supplemental_ghcn_daily INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_atlas (LIKE standard.supplemental_atlas_trade INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_feature (LIKE standard.supplemental_renewable_feature INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_raster (LIKE standard.supplemental_raster_asset INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE incoming_raster_object (
  uri text PRIMARY KEY, sha256 text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0)
) ON COMMIT DROP;

\copy pg_temp.incoming_source (source_sha256,dataset_id,source_version,title,topics,source_url,license_note,expected_rows,semantics) FROM 'source.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_city FROM 'city.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_policy FROM 'policy.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_policy_document FROM 'policy_document.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_wdi FROM 'wdi.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_wri FROM 'wri.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_ghcn_station FROM 'ghcn_station.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_ghcn_daily FROM 'ghcn_daily.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_atlas FROM 'atlas.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_feature FROM 'feature.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_raster FROM 'raster.csv' WITH (FORMAT csv)
\copy pg_temp.incoming_raster_object FROM 'raster_object.csv' WITH (FORMAT csv)

INSERT INTO catalog.supplemental_source SELECT * FROM pg_temp.incoming_source ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_city_power SELECT * FROM pg_temp.incoming_city ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_policy_counts SELECT * FROM pg_temp.incoming_policy ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_policy_document SELECT * FROM pg_temp.incoming_policy_document ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_wdi_emissions SELECT * FROM pg_temp.incoming_wdi ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_wri_plant SELECT * FROM pg_temp.incoming_wri ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_ghcn_station SELECT * FROM pg_temp.incoming_ghcn_station ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_ghcn_daily SELECT * FROM pg_temp.incoming_ghcn_daily ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_atlas_trade SELECT * FROM pg_temp.incoming_atlas ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_renewable_feature SELECT * FROM pg_temp.incoming_feature ON CONFLICT DO NOTHING;
INSERT INTO standard.supplemental_raster_asset AS existing SELECT * FROM pg_temp.incoming_raster
ON CONFLICT (source_sha256, year) DO UPDATE SET archive_uri = EXCLUDED.archive_uri
WHERE existing.archive_uri IS NULL AND EXCLUDED.archive_uri IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_temp.incoming_raster_object) THEN
    INSERT INTO catalog.file_object (uri, sha256, size_bytes, content_type, retention_policy)
    SELECT uri, sha256, size_bytes, 'application/zip', 'permanent' FROM pg_temp.incoming_raster_object
    ON CONFLICT DO NOTHING;
    IF EXISTS (
      SELECT FROM pg_temp.incoming_raster_object incoming JOIN catalog.file_object stored USING (uri)
      WHERE (incoming.sha256, incoming.size_bytes, 'application/zip')
         IS DISTINCT FROM (stored.sha256, stored.size_bytes, stored.content_type)
    ) THEN
      RAISE EXCEPTION 'Raster archive conflicts with the registered storage object';
    END IF;
  END IF;
  IF EXISTS (
    SELECT FROM pg_temp.incoming_source AS source
    CROSS JOIN LATERAL (
      SELECT sum(row_count) AS count FROM (
        SELECT count(*) AS row_count FROM standard.supplemental_city_power WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_policy_counts WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_policy_document WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_wdi_emissions WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_wri_plant WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_ghcn_daily WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_atlas_trade WHERE source_sha256 = source.source_sha256
        UNION ALL
        SELECT count(*) FROM standard.supplemental_raster_asset WHERE source_sha256 = source.source_sha256
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
