CREATE SCHEMA IF NOT EXISTS website_data AUTHORIZATION CURRENT_USER;

CREATE TABLE IF NOT EXISTS website_data.import_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE TABLE IF NOT EXISTS website_data.source_files (
  path text PRIMARY KEY,
  dataset text NOT NULL,
  source_kind text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL,
  modified_at timestamptz NOT NULL,
  sha256 text,
  import_status text NOT NULL,
  record_count bigint,
  error text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_files_dataset_idx
  ON website_data.source_files (dataset, import_status);

CREATE TABLE IF NOT EXISTS website_data.json_documents (
  path text PRIMARY KEY REFERENCES website_data.source_files(path) ON DELETE CASCADE,
  dataset text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS json_documents_dataset_idx
  ON website_data.json_documents (dataset);

CREATE TABLE IF NOT EXISTS website_data.energy_assets (
  id text PRIMARY KEY,
  name text NOT NULL,
  technology text NOT NULL,
  capacity_mw double precision NOT NULL,
  status text NOT NULL,
  country_code text NOT NULL,
  region_id text,
  source text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS energy_assets_country_technology_idx
  ON website_data.energy_assets (country_code, technology);
CREATE INDEX IF NOT EXISTS energy_assets_coordinates_idx
  ON website_data.energy_assets (longitude, latitude);

CREATE TABLE IF NOT EXISTS website_data.data_centers (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  operator text,
  country_code text NOT NULL,
  region_id text,
  source text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_centers_country_kind_idx
  ON website_data.data_centers (country_code, kind);
CREATE INDEX IF NOT EXISTS data_centers_coordinates_idx
  ON website_data.data_centers (longitude, latitude);

CREATE TABLE IF NOT EXISTS website_data.geo_features (
  source_path text NOT NULL,
  feature_index integer NOT NULL,
  dataset text NOT NULL,
  feature_id text,
  geometry_type text,
  geometry jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (source_path, feature_index)
);

CREATE INDEX IF NOT EXISTS geo_features_dataset_idx
  ON website_data.geo_features (dataset, source_path);
CREATE INDEX IF NOT EXISTS geo_features_type_idx
  ON website_data.geo_features (geometry_type);

CREATE TABLE IF NOT EXISTS website_data.vector_tiles (
  path text PRIMARY KEY REFERENCES website_data.source_files(path) ON DELETE CASCADE,
  dataset text NOT NULL,
  z integer,
  x integer,
  y integer,
  content bytea NOT NULL,
  content_encoding text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vector_tiles_coordinates_idx
  ON website_data.vector_tiles (dataset, z, x, y);

CREATE TABLE IF NOT EXISTS website_data.climate_vre_hourly (
  gcm text NOT NULL,
  scenario text NOT NULL,
  region_id text NOT NULL,
  year integer NOT NULL,
  technology text NOT NULL,
  region_label text NOT NULL,
  capacity_mw double precision NOT NULL,
  scale double precision NOT NULL,
  hours integer NOT NULL,
  values_json jsonb NOT NULL,
  stats jsonb NOT NULL,
  metadata jsonb NOT NULL,
  PRIMARY KEY (gcm, scenario, region_id, year, technology)
);

-- Older deployments stored GCM/SSP only inside metadata and used a key that
-- could overwrite a second scenario.  Backfill those rows before enforcing
-- the explicit model-scenario dimensions.
ALTER TABLE website_data.climate_vre_hourly
  ADD COLUMN IF NOT EXISTS gcm text;
ALTER TABLE website_data.climate_vre_hourly
  ADD COLUMN IF NOT EXISTS scenario text;
UPDATE website_data.climate_vre_hourly
SET gcm = COALESCE(NULLIF(gcm, ''), NULLIF(metadata->>'gcm', ''), 'gfdl-esm4'),
    scenario = COALESCE(NULLIF(scenario, ''), NULLIF(metadata->>'scenario', ''), 'ssp126')
WHERE gcm IS NULL OR scenario IS NULL OR gcm = '' OR scenario = '';
ALTER TABLE website_data.climate_vre_hourly
  ALTER COLUMN gcm SET NOT NULL;
ALTER TABLE website_data.climate_vre_hourly
  ALTER COLUMN scenario SET NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='website_data.climate_vre_hourly'::regclass
      AND contype='p'
      AND conname <> 'climate_vre_hourly_model_scenario_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE website_data.climate_vre_hourly DROP CONSTRAINT ' ||
      quote_ident((SELECT conname FROM pg_constraint
        WHERE conrelid='website_data.climate_vre_hourly'::regclass
          AND contype='p' LIMIT 1));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='website_data.climate_vre_hourly'::regclass
      AND conname='climate_vre_hourly_model_scenario_pkey'
  ) THEN
    ALTER TABLE website_data.climate_vre_hourly
      ADD CONSTRAINT climate_vre_hourly_model_scenario_pkey
      PRIMARY KEY (gcm, scenario, region_id, year, technology);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS website_data.climate_vre_sources (
  gcm text NOT NULL,
  scenario text NOT NULL,
  file_name text NOT NULL UNIQUE,
  source_path text NOT NULL,
  expected_size_bytes bigint NOT NULL,
  md5 text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  download_status text NOT NULL DEFAULT 'verified',
  import_status text NOT NULL DEFAULT 'pending',
  imported_rows integer NOT NULL DEFAULT 0,
  source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gcm, scenario)
);

CREATE INDEX IF NOT EXISTS climate_vre_hourly_model_scenario_idx
  ON website_data.climate_vre_hourly (gcm, scenario, year, technology);

CREATE INDEX IF NOT EXISTS climate_vre_hourly_year_technology_idx
  ON website_data.climate_vre_hourly (year, technology);

CREATE TABLE IF NOT EXISTS website_data.dataset_catalog (
  dataset_key text PRIMARY KEY,
  earth_layer text NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  source_url text NOT NULL,
  data_type text NOT NULL,
  spatial_scope text NOT NULL,
  source_resolution_deg double precision,
  project_resolution_deg double precision,
  temporal_resolution text,
  coverage_start date,
  coverage_end date,
  access_method text NOT NULL,
  auth_required boolean NOT NULL DEFAULT false,
  license text,
  acquisition_status text NOT NULL,
  database_status text NOT NULL,
  database_relation text,
  priority text NOT NULL DEFAULT 'medium',
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dataset_catalog_earth_status_idx
  ON website_data.dataset_catalog (earth_layer, acquisition_status, database_status);

CREATE TABLE IF NOT EXISTS website_data.renewable_resource_potential (
  source_key text NOT NULL,
  technology text NOT NULL,
  longitude double precision NOT NULL,
  latitude double precision NOT NULL,
  region text NOT NULL,
  grid text NOT NULL,
  source_year smallint NOT NULL,
  source_resolution_deg double precision NOT NULL,
  project_resolution_deg double precision NOT NULL,
  annual_capacity_factor double precision NOT NULL,
  capacity_potential_gw double precision NOT NULL,
  max_capacity_factor double precision NOT NULL,
  source_cell_count integer NOT NULL,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_key, technology, longitude, latitude, region, grid)
);

CREATE INDEX IF NOT EXISTS renewable_resource_potential_region_technology_idx
  ON website_data.renewable_resource_potential (region, technology);
CREATE INDEX IF NOT EXISTS renewable_resource_potential_coordinates_idx
  ON website_data.renewable_resource_potential (longitude, latitude);

CREATE TABLE IF NOT EXISTS website_data.weather_forecast_fields (
  source text NOT NULL,
  run_time_utc timestamptz NOT NULL,
  forecast_hour smallint NOT NULL,
  valid_time_utc timestamptz NOT NULL,
  metric text NOT NULL,
  unit text NOT NULL,
  field_kind text NOT NULL,
  width smallint NOT NULL,
  height smallint NOT NULL,
  longitude_min double precision NOT NULL,
  latitude_max double precision NOT NULL,
  dx double precision NOT NULL,
  dy double precision NOT NULL,
  compression text NOT NULL CHECK (compression = 'gzip'),
  payload_json_gzip bytea NOT NULL,
  payload_sha256 text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, run_time_utc, forecast_hour, metric)
);

CREATE INDEX IF NOT EXISTS weather_forecast_fields_valid_metric_idx
  ON website_data.weather_forecast_fields (valid_time_utc DESC, metric);

CREATE TABLE IF NOT EXISTS website_data.climate_projection_sources (
  id bigserial PRIMARY KEY,
  zenodo_record_id bigint NOT NULL,
  file_name text NOT NULL UNIQUE,
  gcm text NOT NULL,
  scenario text NOT NULL,
  variable text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  spatial_resolution_deg double precision NOT NULL,
  source_url text NOT NULL,
  expected_size_bytes bigint NOT NULL,
  md5 text NOT NULL,
  license text NOT NULL,
  download_status text NOT NULL DEFAULT 'pending',
  import_status text NOT NULL DEFAULT 'pending',
  imported_days integer NOT NULL DEFAULT 0,
  grid_id bigint,
  source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS climate_projection_sources_model_scenario_idx
  ON website_data.climate_projection_sources (gcm, scenario, variable);

CREATE TABLE IF NOT EXISTS website_data.climate_projection_grids (
  id bigserial PRIMARY KEY,
  grid_hash text NOT NULL UNIQUE,
  grid_type text NOT NULL CHECK (grid_type = 'point-list'),
  point_count integer NOT NULL CHECK (point_count > 0),
  spatial_resolution_deg double precision NOT NULL,
  longitude_min double precision NOT NULL,
  longitude_max double precision NOT NULL,
  latitude_min double precision NOT NULL,
  latitude_max double precision NOT NULL,
  data_type text NOT NULL CHECK (data_type = 'float32'),
  byte_order text NOT NULL CHECK (byte_order = 'little-endian'),
  coordinate_order text NOT NULL CHECK (coordinate_order = 'location,(longitude,latitude)'),
  compression text NOT NULL CHECK (compression = 'gzip'),
  coordinate_data bytea NOT NULL,
  coordinate_sha256 text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE website_data.climate_projection_sources
  ADD COLUMN IF NOT EXISTS grid_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'climate_projection_sources_grid_id_fkey'
  ) THEN
    ALTER TABLE website_data.climate_projection_sources
      ADD CONSTRAINT climate_projection_sources_grid_id_fkey
      FOREIGN KEY (grid_id)
      REFERENCES website_data.climate_projection_grids(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS website_data.climate_projection_daily (
  source_id bigint NOT NULL
    REFERENCES website_data.climate_projection_sources(id) ON DELETE RESTRICT,
  grid_id bigint NOT NULL
    REFERENCES website_data.climate_projection_grids(id) ON DELETE RESTRICT,
  valid_date date NOT NULL,
  variable text NOT NULL,
  unit text NOT NULL,
  hours smallint NOT NULL CHECK (hours > 0),
  point_count integer NOT NULL CHECK (point_count > 0),
  width smallint,
  height smallint,
  longitude_min double precision,
  latitude_max double precision,
  dx double precision,
  dy double precision,
  data_type text NOT NULL CHECK (data_type = 'float32'),
  byte_order text NOT NULL CHECK (byte_order = 'little-endian'),
  dimension_order text NOT NULL CHECK (dimension_order = 'hour,location'),
  compression text NOT NULL CHECK (compression = 'gzip'),
  frame_data bytea NOT NULL,
  frame_sha256 text NOT NULL,
  min_value double precision,
  max_value double precision,
  mean_value double precision,
  missing_count integer NOT NULL,
  statistics jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, valid_date)
);

CREATE INDEX IF NOT EXISTS climate_projection_daily_variable_date_idx
  ON website_data.climate_projection_daily (variable, valid_date);

ALTER TABLE website_data.climate_projection_daily
  ADD COLUMN IF NOT EXISTS grid_id bigint
    REFERENCES website_data.climate_projection_grids(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS point_count integer;

ALTER TABLE website_data.climate_projection_daily
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL,
  ALTER COLUMN longitude_min DROP NOT NULL,
  ALTER COLUMN latitude_max DROP NOT NULL,
  ALTER COLUMN dx DROP NOT NULL,
  ALTER COLUMN dy DROP NOT NULL;

ALTER TABLE website_data.climate_projection_daily
  DROP CONSTRAINT IF EXISTS climate_projection_daily_dimension_order_check;

ALTER TABLE website_data.climate_projection_daily
  ADD CONSTRAINT climate_projection_daily_dimension_order_check
  CHECK (dimension_order IN ('hour,location', 'hour,latitude,longitude'));

CREATE TABLE IF NOT EXISTS website_data.carbon_source_archives (
  official_id bigint PRIMARY KEY,
  sector text NOT NULL,
  data_month date NOT NULL,
  file_name text NOT NULL,
  file_size_label text,
  source_url text NOT NULL,
  api_updated_at timestamptz,
  archive_sha256 text NOT NULL,
  local_archive_path text NOT NULL,
  local_netcdf_path text NOT NULL,
  source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sector, data_month, file_name)
);

CREATE INDEX IF NOT EXISTS carbon_source_archives_sector_month_idx
  ON website_data.carbon_source_archives (sector, data_month DESC);

CREATE TABLE IF NOT EXISTS website_data.carbon_emission_frames (
  observed_on date NOT NULL,
  sector text NOT NULL,
  source_archive_id bigint NOT NULL
    REFERENCES website_data.carbon_source_archives(official_id) ON DELETE RESTRICT,
  unit text NOT NULL CHECK (unit = 'kgC/h'),
  width smallint NOT NULL CHECK (width > 0),
  height smallint NOT NULL CHECK (height > 0),
  longitude_min double precision NOT NULL,
  latitude_max double precision NOT NULL,
  dx double precision NOT NULL CHECK (dx > 0),
  dy double precision NOT NULL CHECK (dy > 0),
  data_type text NOT NULL CHECK (data_type = 'float32'),
  byte_order text NOT NULL CHECK (byte_order = 'little-endian'),
  compression text NOT NULL CHECK (compression = 'gzip'),
  frame_data bytea NOT NULL,
  frame_sha256 text NOT NULL,
  min_value double precision NOT NULL,
  max_value double precision NOT NULL,
  mean_value double precision NOT NULL,
  sum_kgc_per_hour double precision NOT NULL,
  nonzero_count integer NOT NULL,
  statistics jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observed_on, sector)
);

CREATE INDEX IF NOT EXISTS carbon_emission_frames_sector_date_idx
  ON website_data.carbon_emission_frames (sector, observed_on DESC);

CREATE TABLE IF NOT EXISTS website_data.carbon_emission_frame_chunks (
  observed_on date NOT NULL,
  sector text NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  chunk_data bytea NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observed_on, sector, chunk_index)
);
