BEGIN;
SET LOCAL ROLE green_ddl;
SET LOCAL search_path = pg_catalog;

CREATE TABLE IF NOT EXISTS projects.agent_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects.data_project(id),
  kind text NOT NULL CHECK (kind IN ('analysis', 'visualization')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  recent jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recent) = 'array' AND jsonb_array_length(recent) <= 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_session_project_idx ON projects.agent_session (project_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS results.analysis_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects.data_project(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  data_ref jsonb NOT NULL CHECK (jsonb_typeof(data_ref) = 'object'),
  result jsonb,
  error text,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0 AND attempt <= 2),
  lease uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('succeeded', 'failed')) OR result IS NULL)
);
CREATE INDEX IF NOT EXISTS analysis_job_queue_idx ON results.analysis_job (status, created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS analysis_job_project_idx ON results.analysis_job (project_id, created_at DESC);

GRANT USAGE ON SCHEMA projects, results TO green_agent_context, green_agent_ingest;
GRANT SELECT, INSERT, UPDATE ON projects.agent_session TO green_agent_context;
GRANT SELECT, INSERT, UPDATE ON results.analysis_job TO green_agent_context;
GRANT SELECT, UPDATE ON results.analysis_job TO green_agent_ingest;

COMMIT;
