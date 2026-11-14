-- Apply after v11-file-object.sql in the zyz database as its administrator.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE green_ddl;

CREATE TABLE IF NOT EXISTS catalog.weather_replay (
  id text NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  version text NOT NULL CHECK (version ~ '^[0-9a-f]{64}$'),
  region text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  satellite_frames integer NOT NULL CHECK (satellite_frames > 0),
  rain_frames integer NOT NULL CHECK (rain_frames > 0),
  peak_rain_rate numeric NOT NULL CHECK (peak_rain_rate BETWEEN 0 AND 75),
  object_uri text NOT NULL REFERENCES catalog.file_object(uri),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE OR REPLACE VIEW catalog.published_weather_replay AS
SELECT r.*, f.sha256, f.size_bytes
FROM catalog.weather_replay r
JOIN catalog.file_object f ON f.uri = r.object_uri;

GRANT USAGE ON SCHEMA catalog TO green_agent_ingest;
GRANT SELECT ON catalog.published_weather_replay TO green_agent_ro, green_agent_ingest;
GRANT INSERT ON catalog.weather_replay, catalog.file_object TO green_agent_ingest;
COMMIT;
