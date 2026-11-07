BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '90s';

CREATE MATERIALIZED VIEW IF NOT EXISTS derived.osm_power_point AS
SELECT source_path, feature_index, properties->>'id' AS osm_id,
       properties->>'name' AS name, properties->>'kind' AS kind,
       public.ST_Transform(public.ST_GeomFromGeoJSON(geometry), 3857)::public.geometry(Point, 3857) AS geom
FROM power.osm_features
WHERE dataset = 'osm-power' AND geometry_type = 'Point'
  AND jsonb_typeof(geometry->'coordinates'->0) = 'number'
  AND jsonb_typeof(geometry->'coordinates'->1) = 'number'
  AND (geometry->'coordinates'->>0)::numeric BETWEEN -180 AND 180
  AND (geometry->'coordinates'->>1)::numeric BETWEEN -85.05112878 AND 85.05112878;

CREATE UNIQUE INDEX IF NOT EXISTS osm_power_point_source_idx ON derived.osm_power_point (source_path, feature_index);
CREATE INDEX IF NOT EXISTS osm_power_point_geom_idx ON derived.osm_power_point USING gist (geom);
ANALYZE derived.osm_power_point;

CREATE OR REPLACE FUNCTION derived.osm_power_point_tile(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  WITH bounds AS (
    SELECT public.ST_TileEnvelope(z, x, y) AS clip,
           public.ST_TileEnvelope(z, x, y, margin => 64.0 / 4096) AS search
    WHERE z BETWEEN 7 AND 15 AND x >= 0 AND y >= 0 AND x < (1 << z) AND y < (1 << z)
  ), features AS (
    SELECT p.osm_id, p.name, p.kind, public.ST_AsMVTGeom(p.geom, b.clip, 4096, 64, true) AS geom
    FROM bounds b JOIN derived.osm_power_point p ON p.geom OPERATOR(public.&&) b.search
    ORDER BY p.source_path, p.feature_index LIMIT 5000
  )
  SELECT public.ST_AsMVT(f, 'osm_power_points', 4096, 'geom') FROM features f
$$;

REVOKE ALL ON FUNCTION derived.osm_power_point_tile(integer, integer, integer) FROM PUBLIC;
GRANT SELECT ON derived.osm_power_point TO green_agent_ro;
GRANT EXECUTE ON FUNCTION derived.osm_power_point_tile(integer, integer, integer) TO green_agent_ro;
COMMENT ON MATERIALIZED VIEW derived.osm_power_point IS 'OSM 电力点的 Web Mercator 投影。源表更新后执行 REFRESH MATERIALIZED VIEW CONCURRENTLY。';
COMMIT;
