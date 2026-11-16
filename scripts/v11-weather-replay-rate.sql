-- Apply after v11-weather-replay.sql to permit observed model rates over 75 mm/h.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE green_ddl;

ALTER TABLE catalog.weather_replay DROP CONSTRAINT IF EXISTS weather_replay_peak_rain_rate_check;
ALTER TABLE catalog.weather_replay ADD CONSTRAINT weather_replay_peak_rain_rate_check
  CHECK (peak_rain_rate >= 0 AND peak_rain_rate < 'Infinity'::numeric);
COMMIT;
