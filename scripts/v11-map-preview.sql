BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_database() <> 'zyz' THEN
    RAISE EXCEPTION 'Run this migration in the zyz database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_v11_web_map') THEN
    CREATE ROLE green_v11_web_map NOLOGIN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'green_v11_web_map'
      AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'The map role must be an unprivileged NOLOGIN role';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA website_data TO green_v11_web_map;
GRANT SELECT ON TABLE
  website_data.energy_assets,
  website_data.data_centers,
  website_data.geo_features,
  website_data.vector_tiles,
  website_data.json_documents,
  website_data.climate_vre_hourly,
  website_data.carbon_emission_frames,
  website_data.carbon_source_archives
TO green_v11_web_map;

GRANT green_v11_web_map TO green_v11_web_query WITH INHERIT FALSE, SET TRUE;
COMMIT;
