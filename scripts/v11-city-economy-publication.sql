-- Apply after the base Data Agent and supplemental migrations as zyz.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL timezone = 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('opengridworks:v11:data-agent-publication', 0));

-- Copy the already acquired WDI snapshot using the existing migration login's source access.
CREATE TEMP TABLE reviewed_wdi ON COMMIT DROP AS
SELECT * FROM website_data.wdi_stage_country_yearly
WHERE run_id = 'wdi_2015_2024_20260927'
  AND prepared_csv_sha256 = '18bb9d45725b2730b7b2952f63b218a2b7c3319fa8d0dc3cb7e7e51bbc4a3734';
GRANT SELECT ON reviewed_wdi TO green_ddl;
SET LOCAL ROLE green_ddl;

ALTER TABLE catalog.dataset_version DROP CONSTRAINT dataset_version_topic_id_check,
  ADD CHECK (topic_id IN ('meteo', 'power', 'carbon', 'economy'));
ALTER TABLE semantic.sem_metric DROP CONSTRAINT sem_metric_topic_id_check,
  ADD CHECK (topic_id IN ('meteo', 'power', 'carbon', 'economy'));
ALTER TABLE projects.data_project DROP CONSTRAINT data_project_topic_check,
  ADD CHECK (topic IN ('meteo', 'power', 'carbon', 'economy'));
CREATE TABLE IF NOT EXISTS standard.std_data_agent_economy
  PARTITION OF standard.std_data_agent_fact FOR VALUES IN ('economy');

CREATE TEMP TABLE reviewed_city ON COMMIT DROP AS
SELECT f.*, s.source_url FROM standard.supplemental_city_power f
JOIN catalog.supplemental_source s USING (source_sha256)
WHERE s.dataset_id = 'cn_city_power_emissions' AND s.source_version = 'v1';

DO $$
BEGIN
  IF (SELECT count(*) FROM reviewed_city) <> 7040
    OR (SELECT count(DISTINCT source_sha256) FROM reviewed_city) <> 1
    OR (SELECT count(DISTINCT city_code) FROM reviewed_city) <> 352
    OR EXISTS (SELECT FROM reviewed_city GROUP BY city_code HAVING count(DISTINCT year) <> 20)
  THEN RAISE EXCEPTION 'City source does not match the reviewed workbook'; END IF;
  IF (SELECT count(*) FROM reviewed_wdi) <> 2316
    OR (SELECT count(DISTINCT iso3_code) FROM reviewed_wdi) <> 232
    OR EXISTS (SELECT FROM reviewed_wdi GROUP BY iso3_code, year HAVING count(*) > 1)
    OR EXISTS (SELECT FROM reviewed_wdi WHERE iso3_code !~ '^[A-Z0-9]{3}$' OR year NOT BETWEEN 2015 AND 2024
      OR gdp_indicator_code IS DISTINCT FROM 'NY.GDP.MKTP.CD' OR population_indicator_code IS DISTINCT FROM 'SP.POP.TOTL'
      OR gdp_current_usd < 0 OR population_total < 0)
  THEN RAISE EXCEPTION 'WDI source does not match the reviewed snapshot'; END IF;
END
$$;

CREATE TEMP TABLE release_metrics (
  topic_id text, dataset_id text, metric_code text, name text, unit text, data_identity text,
  source_name text, definition text, lineage text, is_default boolean
) ON COMMIT DROP;
INSERT INTO release_metrics VALUES
  ('power', 'power_research_city_annual', 'city_power_generation_annual', '城市发电量年度估算', '亿千瓦时', 'research_estimate',
   'Scientific Data 中国 352 城市电力研究', 'PSO-BP 模型估算城市年度发电量。保持源城市代码与发布原值，缺测保留空值。发电量与用电量是不同指标。',
   '城市源工作簿·发电量列', true),
  ('carbon', 'carbon_research_city_annual', 'city_power_co2_annual', '城市电力部门 CO₂ 年度排放估算', '万吨 CO₂', 'research_estimate',
   'Scientific Data 中国 352 城市电力研究', '按研究估算的城市年度发电量和 2021 年省级电力排放因子计算。口径限电力部门，缺测保留空值。',
   '城市源工作簿·电力部门 CO₂ 列', true),
  ('economy', 'economy_wdi_annual', 'wdi_gdp_current_usd', 'GDP（现价美元）', '美元', 'official_statistics',
   '世界银行 WDI', '世界银行 WDI 指标 NY.GDP.MKTP.CD。采用现价美元，按源经济体和年度返回。保留缺测，跨期价格和汇率基准随年份变化。',
   'World Bank WDI · NY.GDP.MKTP.CD', true),
  ('economy', 'economy_wdi_annual', 'wdi_population_total', '总人口', '人', 'official_statistics',
   '世界银行 WDI', '世界银行 WDI 指标 SP.POP.TOTL。按源经济体和年度返回人口原值，保留缺测，跨年人口数不可相加。',
   'World Bank WDI · SP.POP.TOTL', false);

INSERT INTO semantic.sem_metric (topic_id,dataset_id,metric_code,name,unit,time_grain,data_identity,source_name,definition,review_status)
SELECT topic_id,dataset_id,metric_code,name,unit,'year',data_identity,source_name,definition,'approved' FROM release_metrics
ON CONFLICT (dataset_id,metric_code) DO UPDATE SET name=EXCLUDED.name,unit=EXCLUDED.unit,time_grain=EXCLUDED.time_grain,
  data_identity=EXCLUDED.data_identity,source_name=EXCLUDED.source_name,definition=EXCLUDED.definition,review_status=EXCLUDED.review_status;

CREATE TEMP TABLE release_facts ON COMMIT DROP AS
SELECT m.topic_id,m.dataset_id,m.metric_code,c.city_code AS entity_code,'annual'::text AS series_code,
  make_date(c.year,1,1)::timestamptz AS time_start,
  CASE m.topic_id WHEN 'power' THEN c.generation_100m_kwh ELSE c.emissions_10kt_co2 END AS value,
  jsonb_build_object('url',c.source_url,'paper_url','https://doi.org/10.1038/s41597-026-07484-w',
    'source_sha256',c.source_sha256,'workbook_row',c.workbook_row,'region_name',c.city_name,'reporting_year',c.year) AS source_ref
FROM reviewed_city c CROSS JOIN release_metrics m WHERE m.topic_id IN ('power','carbon')
UNION ALL
SELECT m.topic_id,m.dataset_id,m.metric_code,btrim(w.iso3_code),'annual',make_date(w.year,1,1)::timestamptz,
  CASE m.metric_code WHEN 'wdi_gdp_current_usd' THEN w.gdp_current_usd ELSE w.population_total END,
  jsonb_build_object('url','https://data.worldbank.org/indicator/' ||
    CASE m.metric_code WHEN 'wdi_gdp_current_usd' THEN w.gdp_indicator_code ELSE w.population_indicator_code END,
    'source_sha256',w.prepared_csv_sha256,'source_run',w.run_id,'region_name',w.country_name,'reporting_year',w.year)
FROM reviewed_wdi w CROSS JOIN release_metrics m WHERE m.topic_id='economy';

DO $$
BEGIN
  IF EXISTS (SELECT FROM release_facts WHERE value::text IN ('NaN','Infinity','-Infinity'))
  THEN RAISE EXCEPTION 'Source contains non-finite numbers'; END IF;
END
$$;

CREATE TEMP TABLE release_hashed ON COMMIT DROP AS
SELECT f.*,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') AS source_row_hash FROM release_facts f;

CREATE TEMP TABLE release_versions ON COMMIT DROP AS
WITH metrics AS (
  SELECT m.topic_id,m.dataset_id,r.metric_code,r.is_default,
    to_jsonb(m) || jsonb_build_object('series_codes',ARRAY['annual'],'rules',
      jsonb_build_object('id',r.metric_code||'.v1','period','annual_value','aggregation','published_values_only',
        'missing','preserve_null','forecast','unsupported','lineage',r.lineage,'interpretation',r.definition)) AS metadata
  FROM release_metrics r JOIN semantic.sem_metric m USING (topic_id,dataset_id,metric_code)
), snapshots AS (
  SELECT topic_id,dataset_id,jsonb_object_agg(metric_code,metadata) AS metrics_snapshot,
    (jsonb_agg(metadata) FILTER (WHERE is_default))->0 AS metric_snapshot FROM metrics GROUP BY 1,2
), facts AS (
  SELECT topic_id,dataset_id,count(*)::integer AS row_count,string_agg(source_row_hash,'' ORDER BY source_row_hash) AS hashes
  FROM release_hashed GROUP BY 1,2
)
SELECT s.*,f.row_count,encode(sha256(convert_to(s.metrics_snapshot::text||f.hashes,'UTF8')),'hex') AS version
FROM snapshots s JOIN facts f USING (topic_id,dataset_id);

INSERT INTO catalog.dataset_version (topic_id,dataset_id,version,row_count,metric_snapshot,metrics_snapshot)
SELECT topic_id,dataset_id,version,row_count,metric_snapshot,metrics_snapshot FROM release_versions
ON CONFLICT (dataset_id,version) DO NOTHING;

INSERT INTO standard.std_data_agent_fact
  (topic_id,dataset_id,dataset_version_id,metric_code,entity_code,series_code,time_start,issue_time,
    value,quality_flag,source_ref,source_row_hash)
SELECT h.topic_id,h.dataset_id,v.id,h.metric_code,h.entity_code,h.series_code,h.time_start,NULL,
  h.value,CASE WHEN h.value IS NULL THEN 1 ELSE 0 END,h.source_ref,h.source_row_hash
FROM release_hashed h JOIN release_versions p USING (topic_id,dataset_id)
JOIN catalog.dataset_version v USING (topic_id,dataset_id,version)
ON CONFLICT (topic_id,dataset_version_id,source_row_hash) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM release_versions p JOIN catalog.dataset_version v USING (topic_id,dataset_id,version)
    LEFT JOIN standard.std_data_agent_fact f ON f.topic_id=p.topic_id AND f.dataset_version_id=v.id
    GROUP BY p.dataset_id,p.row_count HAVING count(f.source_row_hash) <> p.row_count
  ) THEN RAISE EXCEPTION 'Published row count does not match the reviewed release'; END IF;
END
$$;

UPDATE catalog.dataset_version v SET is_current=false FROM release_versions p
WHERE v.dataset_id=p.dataset_id AND v.version<>p.version AND v.is_current;
UPDATE catalog.dataset_version v SET is_current=true FROM release_versions p
WHERE v.dataset_id=p.dataset_id AND v.version=p.version AND NOT v.is_current;
SELECT topic_id,dataset_id,row_count,version FROM release_versions ORDER BY topic_id;
COMMIT;
