CREATE SCHEMA IF NOT EXISTS website_data AUTHORIZATION CURRENT_USER;

CREATE TABLE IF NOT EXISTS website_data.forecast_scada_sources (
  source_id text PRIMARY KEY,
  source_name text NOT NULL,
  doi text NOT NULL,
  source_url text NOT NULL,
  license text NOT NULL,
  archive_year integer NOT NULL,
  archive_file_name text NOT NULL,
  archive_size_bytes bigint NOT NULL,
  archive_md5 text NOT NULL,
  native_resolution_minutes smallint NOT NULL,
  entity_id text NOT NULL,
  timezone text NOT NULL,
  import_status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS website_data.forecast_scada_turbines (
  source_id text NOT NULL REFERENCES website_data.forecast_scada_sources(source_id),
  turbine_id text NOT NULL,
  station_id bigint NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  rated_power_kw real NOT NULL,
  manufacturer text NOT NULL,
  model text NOT NULL,
  hub_height_m real,
  rotor_diameter_m real,
  PRIMARY KEY (source_id, turbine_id),
  UNIQUE (source_id, station_id)
);

CREATE TABLE IF NOT EXISTS website_data.forecast_scada_observations (
  source_id text NOT NULL REFERENCES website_data.forecast_scada_sources(source_id),
  observed_at timestamptz NOT NULL,
  active_power_mw real,
  active_energy_mwh real,
  source_status integer,
  source_data_ok boolean,
  quality_code text NOT NULL,
  PRIMARY KEY (source_id, observed_at)
);

CREATE INDEX IF NOT EXISTS forecast_scada_observations_time_idx
  ON website_data.forecast_scada_observations (observed_at);

CREATE TABLE IF NOT EXISTS website_data.forecast_scada_turbine_signals (
  source_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  turbine_id text NOT NULL,
  active_power_kw real,
  wind_speed_mps real,
  running_seconds real,
  ready_seconds real,
  error_seconds real,
  fault_outage_flag boolean,
  curtailment_flag boolean,
  quality_code text NOT NULL,
  PRIMARY KEY (source_id, observed_at, turbine_id),
  FOREIGN KEY (source_id, turbine_id)
    REFERENCES website_data.forecast_scada_turbines(source_id, turbine_id)
);

-- These are source-reported reduction signals, kept separate from
-- curtailment_flag because a reduced-power indication is not proof of grid
-- curtailment.  ADD COLUMN keeps the migration additive for the imported DB.
ALTER TABLE website_data.forecast_scada_turbine_signals
  ADD COLUMN IF NOT EXISTS power_reference_kw real,
  ADD COLUMN IF NOT EXISTS power_reduced_flag boolean,
  ADD COLUMN IF NOT EXISTS power_reduced_seconds real,
  ADD COLUMN IF NOT EXISTS power_reduced_count integer;

COMMENT ON COLUMN website_data.forecast_scada_turbine_signals.power_reference_kw
  IS 'Source field wtc_PowerRef_endvalue; active power setpoint in kW.';
COMMENT ON COLUMN website_data.forecast_scada_turbine_signals.power_reduced_flag
  IS 'Source field wtc_PowerRed_endvalue; reduced-power indication, not a curtailment label.';
COMMENT ON COLUMN website_data.forecast_scada_turbine_signals.power_reduced_seconds
  IS 'Source field wtc_PowerRed_timeon; seconds with the reduced-power input active in the 10-minute period.';
COMMENT ON COLUMN website_data.forecast_scada_turbine_signals.power_reduced_count
  IS 'Source field wtc_PowerRed_counts; input transition/event count in the 10-minute period.';

CREATE INDEX IF NOT EXISTS forecast_scada_turbine_signals_time_idx
  ON website_data.forecast_scada_turbine_signals (observed_at);

CREATE INDEX IF NOT EXISTS forecast_scada_turbine_signals_turbine_time_idx
  ON website_data.forecast_scada_turbine_signals (turbine_id, observed_at);
