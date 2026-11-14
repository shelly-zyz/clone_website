# 气象区域 3D 回放

从气象地球进入「区域 3D 回放」。首个案例使用美国东南沿海 2026-09-26 09:00–15:00 UTC 的 7 帧 SatWeave 11.2 µm 红外亮温和 25 帧 PARDIG-NRT 地面降水率。区域采样间距为 0.2°。降水率由源数据的 m/h 转为 mm/h，缺测保持为空。各来源按有效时刻显示，红外使用不晚于当前降水帧的最近帧。

## 导入和读取

1. 在已经应用对象登记表迁移 `scripts/v11-file-object.sql` 的 `zyz` 数据库执行 `scripts/v11-weather-replay.sql`。
2. 以 Node.js 24 或以上版本运行 `node scripts/import-weather-replay.mjs`。在受限环境文件中设置 `DATA_AGENT_INGEST_DATABASE_URL` 和 `WEATHER_REPLAY_S3_*`。导入连接须能切换到 `green_agent_ingest`，S3 身份须能读写现有的 `raw` 桶。
3. Web 进程配置 `DATA_AGENT_DATABASE_URL` 和独立的只读 S3 身份。调用 `GET /api/weather-replay` 读取已登记的样例。可通过 `id` 和 `version` 读取指定案例及其固定版本。响应的 ETag 为对象的 SHA-256。
4. 在 `/workspace?topic=weather` 打开区域回放，验证播放、时间轴、图层开关、两个视图切换及视角旋转。数据缺失或暂时不可用时，页面提供重试。

导入先读取并校验区域帧，再按内容哈希写入 SeaweedFS，回读验证后在一个 PostgreSQL 事务中登记文件和回放。相同版本的重复导入可安全重试。数据库智能体可通过只读 MCP 工具 `list_weather_replays` 核对案例、时间、帧数、峰值降水率、来源和版本，并返回固定版本的页面地址。智能体已有的普通气象问答当前仍查询登记过的 GFS 等指标。

首个案例按指定时间窗手动导入。持续抓取、滚动保留和自选区域生成属于后续扩展。

来源为 [SatWeave](https://developers.google.cn/weathernext/guides/satweave) 与 [PARDIG](https://developers.google.cn/weathernext/guides/pardig)，Google DeepMind 和 Google Research，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
