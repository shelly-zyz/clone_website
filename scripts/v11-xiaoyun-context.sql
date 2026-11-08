BEGIN;
SET LOCAL ROLE green_ddl;
SET LOCAL search_path = pg_catalog;

ALTER TABLE projects.data_session
  ADD COLUMN IF NOT EXISTS xiaoyun_pending jsonb CHECK (jsonb_typeof(xiaoyun_pending) = 'object');
GRANT SELECT (xiaoyun_pending), UPDATE (xiaoyun_pending) ON projects.data_session TO green_agent_context;

COMMIT;
