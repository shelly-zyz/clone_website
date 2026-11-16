-- Apply after v11-weather-replay.sql in zyz using the existing DDL role.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_database() <> 'zyz' THEN
    RAISE EXCEPTION 'Apply the weather replay migration in zyz';
  END IF;
END;
$$;

SET LOCAL ROLE green_ddl;

CREATE TABLE IF NOT EXISTS catalog.weather_replay_payload (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  body bytea NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 2000000),
  CHECK (encode(pg_catalog.sha256(body), 'hex') = sha256)
);

CREATE OR REPLACE VIEW catalog.published_weather_replay_payload AS
SELECT r.id, r.version, r.published_at, r.object_uri, r.sha256, r.size_bytes, p.body,
  r.satellite_frames, r.rain_frames
FROM catalog.published_weather_replay r
LEFT JOIN catalog.weather_replay_payload p
  ON p.sha256 = r.sha256 AND octet_length(p.body) = r.size_bytes;

GRANT INSERT ON catalog.weather_replay_payload TO green_agent_ingest;
GRANT SELECT ON catalog.published_weather_replay_payload TO green_agent_ro, green_agent_ingest;
COMMIT;
