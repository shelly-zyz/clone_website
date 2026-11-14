-- Apply after v11-weather-replay.sql. Source definitions are proposed for semantic review.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE green_ddl;

INSERT INTO semantic.sem_metric
  (dataset_id, topic_id, metric_code, name, unit, time_grain, data_identity, source_name, definition, review_status)
VALUES
  ('meteo_satweave', 'meteo', 'infrared_brightness_temperature_11200_nm', '11.2 μm 红外亮温', 'K',
   '1h', 'satellite_observation', 'Google DeepMind / Google Research SatWeave',
   '长波红外窗区的卫星亮温拼图，按 UTC 有效时刻登记；回放对 0.1° 源网格隔点采样为 0.2°，缺测保留为空。亮温同时受云和地表影响。', 'draft'),
  ('meteo_pardig_nrt', 'meteo', 'surface_precipitation_rate', '地表瞬时降水率估计', 'mm/h',
   '15min', 'research_estimate', 'Google DeepMind / Google Research PARDIG-NRT',
   '每 15 分钟的瞬时格点降水率估计，源值 m/h 乘以 1000；回放降采样到 0.2°，缺测保留为空，产品上限 75 mm/h。', 'draft'),
  ('meteo_pardig_nrt', 'meteo', 'replay_accumulated_precipitation', '从回放起点估算的累计降水', 'mm',
   'replay_elapsed', 'research_estimate', 'OpenGridWorks / PARDIG-NRT',
   '对回放起点至当前时刻之间的连续瞬时降水率做梯形积分。任一参与帧缺测时该格点累计缺测。', 'draft')
ON CONFLICT (dataset_id, metric_code) DO NOTHING;

COMMIT;
