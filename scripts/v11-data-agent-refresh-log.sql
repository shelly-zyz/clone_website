BEGIN;
SET LOCAL ROLE green_ddl;
SET LOCAL search_path = pg_catalog;

CREATE TABLE IF NOT EXISTS staging.nbs_refresh_run (
  checked_at timestamptz NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('ok', 'failed')),
  details jsonb NOT NULL,
  PRIMARY KEY (checked_at, id)
);
SELECT public.create_hypertable('staging.nbs_refresh_run', 'checked_at', if_not_exists => true);
GRANT INSERT ON staging.nbs_refresh_run TO green_agent_ingest;
GRANT SELECT ON staging.nbs_refresh_run TO green_agent_review;
COMMIT;
