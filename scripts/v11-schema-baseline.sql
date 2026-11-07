-- Run against the zyz database as its owner, zyz, with psql ON_ERROR_STOP enabled.
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

CREATE SCHEMA IF NOT EXISTS catalog AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS staging AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS standard AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS derived AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS results AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS semantic AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS projects AUTHORIZATION green_ddl;
CREATE SCHEMA IF NOT EXISTS knowledge AUTHORIZATION green_ddl;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_namespace
    WHERE nspname IN ('catalog', 'staging', 'standard', 'derived', 'results', 'semantic', 'projects', 'knowledge')
      AND nspowner <> 'green_ddl'::regrole
  ) THEN
    RAISE EXCEPTION 'A V11 schema already exists with an owner other than green_ddl';
  END IF;
END;
$$;

SET LOCAL ROLE green_ddl;

-- Table, view, and sequence privileges are assigned in the migrations that publish them.
GRANT USAGE ON SCHEMA catalog, standard, derived, results, projects, knowledge TO green_app;
GRANT USAGE ON SCHEMA standard, derived TO green_agent_ro;

COMMIT;
