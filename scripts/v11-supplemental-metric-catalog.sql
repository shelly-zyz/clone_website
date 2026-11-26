-- Apply after v11-supplemental-ingest.sql.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

WITH verified_graced AS (
  SELECT sector, min(observed_on) AS first_day, max(observed_on) AS last_day, count(*) AS frames
  FROM website_data.carbon_emission_frames
  WHERE sector IN ('Industry','total') AND frame_data IS NOT NULL GROUP BY sector
  HAVING count(*)=(max(observed_on)-min(observed_on)+1)
)
UPDATE website_data.dataset_catalog d SET database_status='imported',
  coverage_start=g.first_day, coverage_end=g.last_day, updated_at=now()
FROM verified_graced g
WHERE d.dataset_key=CASE g.sector WHEN 'Industry' THEN 'graced-industry' ELSE 'graced-total' END
  AND (d.database_status,d.coverage_start,d.coverage_end)
      IS DISTINCT FROM ('imported',g.first_day,g.last_day);

SET LOCAL ROLE green_ddl;
CREATE OR REPLACE VIEW semantic.supplemental_metric_catalog AS
WITH definitions (dataset_id, topic_id, metric_code, name, unit, time_grain, entity_type, aggregation, missing, query_access, released_dataset) AS (
  VALUES
    ('cn_city_power_emissions','power','city_power_generation_annual','城市发电量年度估算','亿千瓦时','year','中国城市六位源代码','按发布原值；不重算省级总量','保留空值','approved_series','power_research_city_annual'),
    ('cn_city_power_emissions','carbon','city_power_co2_annual','城市电力部门 CO₂ 年度排放估算','万吨 CO₂','year','中国城市六位源代码','按发布原值；不可当作全行业排放','保留空值','approved_series','carbon_research_city_annual'),
    ('cn_carbon_source_inventory',NULL,'carbon_source_files','源文件索引','文件','inventory','数据族和源文件路径','按源相对路径计数','缺目录不等于缺数据','metadata_only',NULL),
    ('cn_energy_transition_policy_documents',NULL,'policy_documents','政策条目','份','document','发布方政策 ID 和发文机关','按唯一 gid 去重；标签可重叠','缺标签不等于没有政策','document_only',NULL),
    ('global_electricity_1km',NULL,'annual_electricity_pixel','年用电量估算','kWh / 年 / 像元','year','World Mollweide 1 km 网格；源覆盖 134 个国家或地区','区域统计需先应用覆盖掩膜','区分掩膜外零、真实零与 NoData','asset_only',NULL),
    ('global_real_gdp_1km',NULL,'annual_real_gdp_pixel','实际 GDP 栅格估算','百万 2017 年美元 / 年 / 像元','year','World Mollweide 1 km 网格；源覆盖 175 个国家或地区','区域统计需先应用覆盖掩膜','区分掩膜外零、真实零与 NoData','asset_only',NULL),
    ('global_renewables_watch_solar',NULL,'solar_facilities','已识别光伏设施','处','quarter','全球商业、工业和公用事业光伏场；按源国家标签','去重设施 ID；基线与后续首次识别分别统计','五条空几何保留，空间运算排除','spatial_only',NULL),
    ('global_renewables_watch_solar',NULL,'solar_polygon_area','光伏场多边形面积','m²（等积或测地计算）','quarter','同一来源光伏场几何','经几何校验后算面积；不能推算实测装机','排除空或无效几何','derived_required',NULL),
    ('global_renewables_watch_wind',NULL,'wind_turbines','已识别陆上风机','台','quarter','全球陆上可识别设施；按源国家标签','去重源设施 ID；季度为首次识别，起始季度含基线','区域覆盖不足不按零补足','spatial_only',NULL),
    ('wri_global_power_plant_database',NULL,'wri_capacity','电厂装机容量','MW','snapshot','167 个国家或地区的单厂','按唯一电厂 ID；与 GRW、OSM 跨库加总前做实体匹配','保持源空值','asset_only',NULL),
    ('wri_global_power_plant_database',NULL,'wri_generation_reported','报告的年度发电量','GWh','year','电厂；2013–2019','只返回来源报告列','保持源空值','asset_only',NULL),
    ('wri_global_power_plant_database',NULL,'wri_generation_estimated','模型估算的年度发电量','GWh','year','电厂；2013–2017','只返回估算列，保留原估算口径','保持源空值','asset_only',NULL),
    ('noaa_ghcn_daily_china_2024',NULL,'ghcn_tmax','站点日最高气温','0.1 °C','day','2024 年 201 个中国站点，按 NOAA 站号','读取站点当地观测日原值','保留质量码，-9999 转空','staged_series',NULL),
    ('noaa_ghcn_daily_china_2024',NULL,'ghcn_tmin','站点日最低气温','0.1 °C','day','2024 年 201 个中国站点，按 NOAA 站号','读取站点当地观测日原值','保留质量码，-9999 转空','staged_series',NULL),
    ('noaa_ghcn_daily_china_2024',NULL,'ghcn_prcp','站点日降水量','0.1 mm','day','2024 年 201 个中国站点，按 NOAA 站号','读取站点当地观测日原值','保留质量码，-9999 转空','staged_series',NULL),
    ('noaa_ghcn_daily_china_2024',NULL,'ghcn_snow','站点日新雪量','mm','day','2024 年 201 个中国站点，按 NOAA 站号','读取站点当地观测日原值','保留质量码，-9999 转空','staged_series',NULL),
    ('wdi_edgar_co2_excl_lulucf',NULL,'edgar_co2_excl_lulucf','年度 CO₂ 排放（不含 LULUCF）','Mt CO₂e','year','来源经济体或地区聚合','按发布单个实体原值；经济体和地区聚合不可混加','源缺测保留空值','staged_series',NULL),
    ('wdi_edgar_all_excl_lulucf',NULL,'edgar_ghg_excl_lulucf','年度温室气体排放（不含 LULUCF）','Mt CO₂e','year','来源经济体或地区聚合','按发布单个实体原值；经济体和地区聚合不可混加','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_bilateral',NULL,'atlas_bilateral_exports','双边商品出口额','当年价 USD','year','报告经济体 × 伙伴经济体','按出口方向和源实体读取；保留统计口径','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_bilateral',NULL,'atlas_bilateral_imports','双边商品进口额','当年价 USD','year','报告经济体 × 伙伴经济体','按进口方向和源实体读取；保留统计口径','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_country_hs2',NULL,'atlas_hs2_exports','商品章出口额','当年价 USD','year','经济体 × HS 1992 两位商品章','按唯一商品章和源经济体读取','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_country_hs2',NULL,'atlas_hs2_imports','商品章进口额','当年价 USD','year','经济体 × HS 1992 两位商品章','按唯一商品章和源经济体读取','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_country_hs2',NULL,'atlas_global_market_share','商品章全球市场份额','源比例','year','经济体 × HS 1992 两位商品章','比例按源定义读取；跨章不可直接相加','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_country_hs2',NULL,'atlas_distance','产品空间距离','无量纲','year','经济体 × HS 1992 两位商品章','模型指标按源原值读取','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_country_hs2',NULL,'atlas_complexity_outlook_gain','复杂性展望收益','无量纲','year','经济体 × HS 1992 两位商品章','模型指标按源原值读取','源缺测保留空值','staged_series',NULL),
    ('harvard_atlas_hs92_country_hs2',NULL,'atlas_product_complexity','产品复杂性指数','无量纲','year','经济体 × HS 1992 两位商品章','模型指标按源原值读取','源缺测保留空值','staged_series',NULL)
), matched AS (
  SELECT s.*, d.metric_code, d.name, d.unit, d.time_grain, d.entity_type, d.aggregation, d.missing, d.query_access, d.released_dataset
  FROM semantic.supplemental_dataset_catalog s JOIN definitions d USING (dataset_id)
  WHERE d.topic_id IS NULL OR s.topic_id=d.topic_id
  UNION ALL
  SELECT s.*, 'policy_'||t.label, '年度政策标签次数 · '||t.label,'次','year',s.semantics->>'grain',
    '按同一行政层级、同一地区和生效年读取。标签与小计可能重叠，不可直接相加。',
    '没有地区年度记录时保留为缺测。','staged_series',NULL
  FROM semantic.supplemental_dataset_catalog s
  CROSS JOIN LATERAL jsonb_each(s.semantics->'labels') g
  CROSS JOIN LATERAL jsonb_array_elements_text(g.value) t(label)
  WHERE s.dataset_id IN ('cn_energy_transition_policy_national','cn_energy_transition_policy_provincial','cn_energy_transition_policy_prefecture')
)
SELECT m.topic_id,m.dataset_id,m.source_version,m.source_sha256,m.metric_code,m.name,m.unit,m.time_grain,m.entity_type,
  COALESCE(m.semantics->'coverage',to_jsonb(m.semantics->>'coverage_note')) AS coverage,
  m.aggregation,m.missing,m.source_url,m.license_note,m.semantics->>'table' AS source_relation,
  CASE WHEN p.id IS NOT NULL THEN 'published' WHEN m.released_dataset IS NOT NULL THEN 'staged_series' ELSE m.query_access END AS query_access,
  p.dataset_id AS published_dataset_id,p.version AS published_version
FROM matched m
LEFT JOIN catalog.dataset_version p ON p.topic_id=m.topic_id AND p.dataset_id=m.released_dataset AND p.is_current
  AND EXISTS (SELECT FROM standard.std_data_agent_fact f WHERE f.topic_id=p.topic_id AND f.dataset_version_id=p.id
    AND f.metric_code=m.metric_code AND f.source_ref->>'source_sha256'=m.source_sha256);

GRANT SELECT ON semantic.supplemental_metric_catalog TO green_agent_ro;
COMMENT ON VIEW semantic.supplemental_metric_catalog IS '四专题补充指标的计量口径、空间键、缺测、来源与受控查询状态。';
COMMIT;
