BEGIN;
SET LOCAL search_path = pg_catalog;
CREATE SCHEMA IF NOT EXISTS knowledge AUTHORIZATION green_ddl;
SET LOCAL ROLE green_ddl;

CREATE TABLE IF NOT EXISTS knowledge.document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200)
);

CREATE TABLE IF NOT EXISTS knowledge.document_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge.document(id),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 100),
  source_url text NOT NULL CHECK (source_url ~ '^https://[^[:space:]]+$' AND length(source_url) <= 800),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  reviewed_at timestamptz,
  valid_from date,
  valid_until date,
  CHECK (review_status <> 'approved' OR reviewed_at IS NOT NULL),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  UNIQUE (document_id, version)
);

CREATE TABLE IF NOT EXISTS knowledge.chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES knowledge.document_version(id),
  locator text NOT NULL CHECK (length(locator) BETWEEN 1 AND 250),
  source_fragment text CHECK (source_fragment ~ '^#[a-zA-Z0-9%_.=-]+$' AND length(source_fragment) <= 199),
  passage text NOT NULL CHECK (length(passage) BETWEEN 1 AND 2500),
  keywords text NOT NULL DEFAULT '',
  claim_key text,
  claim_value text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  CHECK ((claim_key IS NULL) = (claim_value IS NULL)),
  UNIQUE (version_id, locator)
);

CREATE OR REPLACE VIEW knowledge.approved_passage AS
SELECT c.id, d.title, v.version, c.locator, v.source_url || COALESCE(c.source_fragment,'') AS url,
       c.passage, c.keywords, c.claim_key, c.claim_value, v.valid_from, v.valid_until, v.reviewed_at
FROM knowledge.chunk c
JOIN knowledge.document_version v ON v.id = c.version_id
JOIN knowledge.document d ON d.id = v.document_id
WHERE c.review_status = 'approved' AND v.review_status = 'approved';

GRANT USAGE ON SCHEMA knowledge TO green_agent_ro;
GRANT SELECT ON knowledge.approved_passage TO green_agent_ro;

CREATE TABLE IF NOT EXISTS projects.xiaoyun_project_view (
  project_id uuid NOT NULL REFERENCES projects.data_project(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 8192),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name)
);
CREATE INDEX IF NOT EXISTS xiaoyun_project_view_recent_idx ON projects.xiaoyun_project_view (project_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE ON projects.xiaoyun_project_view TO green_agent_context;

-- Each bundled passage points to the exact released project-document revision.
INSERT INTO knowledge.document(id,title) VALUES
  ('17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad001','OpenGridWorks Agent 业务规则与预测验收')
ON CONFLICT (id) DO NOTHING;
INSERT INTO knowledge.document_version(id,document_id,version,source_url,content_sha256,review_status,reviewed_at) VALUES
  ('17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad002','17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad001','ccc98fd',
   'https://github.com/shelly-zyz/clone_website/blob/ccc98fd390bb91e5b914493994b50a6f94b8cd58/docs/v11-agent-policy.md',
   'e85f5aaa488a6788868fc0177175c976007f7b8ce4285622758a730999b86cf0','approved','2026-11-16T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
INSERT INTO knowledge.chunk(id,version_id,locator,source_fragment,passage,keywords,review_status) VALUES
  ('17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad003','17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad002','预测模型选择 · 统计误差','#L32','| 比较统计模型，或要求先选再预测 | 在同一个连续序列上，用三个不重叠的滚动验证窗口比较 SeasonalNaive、AutoETS、AutoARIMA。初始训练至少 24 期；按 MAE 选，RMSE 作为同分比较依据。MAE 改善超过 5% 才升级，否则保留基线。用于预测时按获选方法用全样本重新拟合 |','MAE RMSE 误差 滚动 回测 基线 选模','approved'),
  ('17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad004','17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad002','预测模型选择 · 数据断档','#L34','| 没有可用历史、粒度不符、数据有断档 | 说明原因并请求补齐，不自动插值或把类别数据改作序列 |','断档 缺测 数据 粒度 插值 预测','approved'),
  ('17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad005','17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad002','结果与审计 · 数据引用','#L21','- 查询返回 `result_id`、`DataRef`、版本、口径、单位、覆盖和质量。单指标趋势使用时间轴；同月省级比较返回类别轴，只使用该版本同指标、同产品的省级数据，不包含全国汇总。图表与预测共享结果引用，按权限重新读取。','DataRef 版本 口径 来源 省级 数据','approved'),
  ('17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad006','17ae9cc9-0dba-47f2-9f5e-dd2c9b7ad002','权限与资源 · 角色','#L15','HTTP 和 MCP 使用同一来源及服务凭据校验。已发布目录和固定查询可以凭服务授权访问；项目会话、产物和任务另需该项目凭据。生产入口需要部署侧认证，现有项目密钥按持有者授权，未引入账户级成员体系。','权限 项目 凭据 认证 账户 审核','approved')
ON CONFLICT (id) DO NOTHING;

COMMIT;
