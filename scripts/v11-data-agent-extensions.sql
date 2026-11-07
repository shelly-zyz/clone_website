-- Run as a PostgreSQL administrator in zyz after installing compatible binaries
-- and configuring shared_preload_libraries for TimescaleDB.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'zyz' THEN RAISE EXCEPTION 'Run the extension migration in zyz'; END IF;
END
$$;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'green_agent_ingest') THEN CREATE ROLE green_agent_ingest NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'green_agent_review') THEN CREATE ROLE green_agent_review NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'green_agent_context') THEN CREATE ROLE green_agent_context NOLOGIN; END IF;
END
$$;
GRANT green_agent_ingest, green_agent_review, green_agent_context TO zyz, green_ddl;
COMMIT;
