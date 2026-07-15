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
  PRIMARY KEY (region_id, year, technology)
);

CREATE INDEX IF NOT EXISTS climate_vre_hourly_year_technology_idx
  ON website_data.climate_vre_hourly (year, technology);

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
