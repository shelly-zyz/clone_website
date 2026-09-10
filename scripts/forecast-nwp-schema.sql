CREATE SCHEMA IF NOT EXISTS website_data AUTHORIZATION CURRENT_USER;

CREATE TABLE IF NOT EXISTS website_data.forecast_nwp_sources (
  source_id text PRIMARY KEY,
  source_name text NOT NULL,
  publisher text NOT NULL,
  product_url text NOT NULL,
  data_identity text NOT NULL,
  native_resolution_hours smallint NOT NULL,
  grid_resolution_degrees real NOT NULL,
  entity_id text NOT NULL,
  import_status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS website_data.forecast_nwp_points (
  source_id text NOT NULL REFERENCES website_data.forecast_nwp_sources(source_id),
  entity_id text NOT NULL,
  issue_time timestamptz NOT NULL,
  valid_time timestamptz NOT NULL,
  forecast_hour smallint NOT NULL,
  target_latitude double precision NOT NULL,
  target_longitude double precision NOT NULL,
  grid_latitude double precision NOT NULL,
  grid_longitude double precision NOT NULL,
  u100_mps real NOT NULL,
  v100_mps real NOT NULL,
  wind_speed_mps real NOT NULL,
  quality_code text NOT NULL,
  source_file_url text NOT NULL,
  source_index_url text NOT NULL,
  source_file_etag text,
  source_file_bytes bigint,
  selected_range_start bigint NOT NULL,
  selected_range_end bigint NOT NULL,
  selected_payload_bytes integer NOT NULL,
  selected_payload_md5 text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (source_id, entity_id, issue_time, forecast_hour),
  UNIQUE (source_id, entity_id, valid_time)
);

CREATE INDEX IF NOT EXISTS forecast_nwp_points_valid_time_idx
  ON website_data.forecast_nwp_points (entity_id, valid_time);

CREATE TABLE IF NOT EXISTS website_data.forecast_training_pairs (
  entity_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  entity_level text NOT NULL,
  technology text NOT NULL,
  entity_latitude double precision NOT NULL,
  entity_longitude double precision NOT NULL,
  observed_power_mw real NOT NULL,
  observed_power_unit text NOT NULL,
  nwp_issue_time timestamptz NOT NULL,
  nwp_valid_time timestamptz NOT NULL,
  nwp_u100_mps real NOT NULL,
  nwp_v100_mps real NOT NULL,
  nwp_wind_speed_mps real NOT NULL,
  nwp_interpolation_method text NOT NULL,
  nwp_native_prev_valid_time timestamptz,
  nwp_native_next_valid_time timestamptz,
  nwp_interpolation_fraction real,
  installed_capacity_mw real NOT NULL,
  available_capacity_mw real NOT NULL,
  outage_flag boolean NOT NULL,
  curtailment_flag boolean NOT NULL,
  curtailment_known boolean NOT NULL DEFAULT false,
  timezone text NOT NULL,
  quality_code text NOT NULL,
  data_identity text NOT NULL,
  observation_source text NOT NULL,
  nwp_source text NOT NULL,
  data_license text NOT NULL,
  resolution_minutes smallint NOT NULL,
  audit_status text NOT NULL DEFAULT 'research-only',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (entity_id, observed_at)
);

CREATE INDEX IF NOT EXISTS forecast_training_pairs_observed_at_idx
  ON website_data.forecast_training_pairs (observed_at);

COMMENT ON TABLE website_data.forecast_nwp_points IS
  'Source-backed historical issued GFS point values. Raw GRIB is not copied into PostgreSQL; URL, ETag, byte range, and payload MD5 are retained for provenance.';
COMMENT ON TABLE website_data.forecast_training_pairs IS
  'Hourly Hill of Towie historical pairs for backtest/research. curtailment_known=false keeps the production forecast gate locked.';
