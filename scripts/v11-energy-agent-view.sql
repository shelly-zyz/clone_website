-- Execute as zyz after v11-schema-baseline.sql.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_database() <> 'zyz' OR current_user <> 'zyz' THEN
    RAISE EXCEPTION 'Run this migration as zyz in the zyz database';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW derived.energy_asset_summary WITH (security_barrier = true) AS
SELECT technology,
       count(*)::integer AS records,
       coalesce(sum(capacity_mw) FILTER (WHERE capacity_mw > 0 AND capacity_mw < 'Infinity'::double precision), 0) AS capacity_mw,
       array_agg(DISTINCT source ORDER BY source) AS sources
FROM website_data.energy_assets
WHERE country_code IN ('CN', 'CHN')
  AND technology IN ('coal', 'gas', 'geothermal', 'hydro', 'nuclear', 'offshore', 'oil', 'solar', 'wind')
GROUP BY technology;

COMMENT ON VIEW derived.energy_asset_summary IS 'China map sample grouped by technology. Includes mixed project statuses and potential source overlap.';
GRANT SELECT ON derived.energy_asset_summary TO green_agent_ro;

COMMIT;
