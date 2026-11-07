BEGIN;
SET LOCAL ROLE green_ddl;
SET LOCAL search_path = pg_catalog;

CREATE TABLE IF NOT EXISTS projects.data_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL CHECK (topic IN ('meteo', 'power', 'carbon')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  access_hash text NOT NULL CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects.data_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects.data_project(id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_session_project_idx ON projects.data_session (project_id, created_at);

CREATE TABLE IF NOT EXISTS results.data_query_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects.data_project(id),
  query_hash text NOT NULL CHECK (query_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, query_hash)
);
CREATE TABLE IF NOT EXISTS projects.data_session_turn (
  session_id uuid NOT NULL REFERENCES projects.data_session(id),
  revision integer NOT NULL CHECK (revision > 0),
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('ok', 'empty', 'missing', 'needs_clarification')),
  result_id uuid REFERENCES results.data_query_result(id),
  trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, revision)
);

CREATE TABLE IF NOT EXISTS projects.map_assistant_thread (
  access_hash text PRIMARY KEY CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  recent jsonb NOT NULL CHECK (jsonb_typeof(recent) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA projects, results TO green_agent_context;
GRANT SELECT, INSERT ON projects.data_project, projects.data_session, projects.data_session_turn, results.data_query_result TO green_agent_context;
GRANT UPDATE (revision, summary) ON projects.data_session TO green_agent_context;
GRANT SELECT, INSERT, UPDATE ON projects.map_assistant_thread TO green_agent_context;

COMMIT;
