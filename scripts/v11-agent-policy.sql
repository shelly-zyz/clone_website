BEGIN;
SET LOCAL ROLE green_ddl;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

ALTER TABLE projects.data_session ADD COLUMN IF NOT EXISTS xiaoyun_analysis_pending jsonb
  CHECK (jsonb_typeof(xiaoyun_analysis_pending) = 'object');
GRANT SELECT (xiaoyun_analysis_pending), UPDATE (xiaoyun_analysis_pending) ON projects.data_session TO green_agent_context;
ALTER TABLE projects.data_session_turn ADD COLUMN IF NOT EXISTS xiaoyun_request_id uuid;
GRANT SELECT (xiaoyun_request_id), INSERT (xiaoyun_request_id) ON projects.data_session_turn TO green_agent_context;
CREATE UNIQUE INDEX IF NOT EXISTS data_session_turn_xiaoyun_request_idx
  ON projects.data_session_turn(session_id, xiaoyun_request_id) WHERE xiaoyun_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS results.analysis_worker (
  id uuid PRIMARY KEY,
  capabilities text[] NOT NULL CHECK (cardinality(capabilities) BETWEEN 1 AND 5
    AND capabilities <@ ARRAY['describe','cluster','statsforecast','timesfm','chronos2']::text[]),
  device text NOT NULL CHECK (device IN ('cpu', 'cuda')),
  ready_until timestamptz NOT NULL
);
GRANT SELECT ON results.analysis_worker TO green_agent_context;
GRANT SELECT, INSERT, UPDATE, DELETE ON results.analysis_worker TO green_agent_ingest;
CREATE TABLE IF NOT EXISTS projects.agent_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object' AND
    event ?& ARRAY['schema','time','run_id','actor','action','outcome'] AND event->>'schema' = 'ogw.agent.audit.v1')
);
CREATE INDEX IF NOT EXISTS agent_audit_run_idx ON projects.agent_audit_event ((event->>'run_id'), created_at);
GRANT USAGE ON SCHEMA projects TO green_agent_context, green_agent_ingest, green_agent_review;
GRANT INSERT (event) ON projects.agent_audit_event TO green_agent_context, green_agent_ingest, green_agent_review;
COMMIT;
