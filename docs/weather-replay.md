# 气象区域 3D 回放

在气象地球右上角用缩略图切换全球风场、云雨叠加、降水时空层、降雨粒子和累计降水。首个案例覆盖西北大西洋 23–35°N、80–64°W，使用 2026-09-26 09:00–15:00 UTC 的 7 帧 SatWeave 11.2 µm 红外亮温和 25 帧 PARDIG-NRT 地面降水率。采样间距为 0.2°，降水时间步长为 15 分钟。降水率由源数据的 m/h 转为 mm/h，缺测保持为空。红外使用不晚于当前降水帧的最近帧。

## 区域和场景

左栏的「回放区域」由四个 3D 模式共用。档案全域保留海上降水，美国和巴哈马只显示国界与档案相交的部分。中国显示地理轮廓和无已发布回放的提示。底板使用从项目内 Natural Earth 1:50m `ADM0_A3` 底图提取的 `public/data/weather-replay/regions.geojson`，包括 USA、BHS、BMU、CUB 和 CHN。地图、源网格和雨滴采用同一等距圆柱坐标，并按区域中心纬度校正东西向比例。国界同时用于数据面的透明遮罩和原始格点读数筛选。

- 云雨叠加在较高位置显示半透明红外纹理，下层用连续色场和低矮曲面显示降水率。云层高度用于分层展示。
- 降水时空层最多显示五层，按有效时间相隔至少 30 分钟取样。各层共用地理轮廓，海上只绘制有效降水。标签显示实际有效时刻。
- 降雨粒子在地理网格内采样，密度随降水率变化。GPU 让雨滴沿场景竖轴持续下降，时间轴暂停时仍播放下落效果。浏览器的减少动态效果设置可暂停下落。
- 累计降水按同一时间窗内相邻有效时刻作梯形积分。缺任一帧的格点保持缺测。曲面高度使用区域内全时段固定尺度，显示时对相邻格点作一格平滑和插值，读数使用原始格点累计值。

## 导入和读取

1. 在已经应用对象登记表迁移 `scripts/v11-file-object.sql` 的 `zyz` 数据库依次执行 `scripts/v11-weather-replay.sql` 和 `scripts/v11-weather-replay-semantics.sql`。
2. 以 Node.js 24 或以上版本运行 `node scripts/import-weather-replay.mjs`。在受限环境文件中设置 `DATA_AGENT_INGEST_DATABASE_URL` 和 `WEATHER_REPLAY_S3_*`。导入连接须能切换到 `green_agent_ingest`，S3 身份须能读写现有的 `raw` 桶。
3. Web 进程配置 `DATA_AGENT_DATABASE_URL` 和独立的只读 S3 身份。调用 `GET /api/weather-replay` 读取已登记的样例。可通过 `id` 和 `version` 读取指定案例及其固定版本。响应的 ETag 为对象的 SHA-256。
4. 在 `/workspace?topic=weather` 打开区域回放，验证播放、时间轴、图层开关、视图切换及视角旋转。数据缺失或暂时不可用时，页面提供重试。

本地运行 `npm run dev` 时，三项 `WEATHER_REPLAY_S3_*` 配置可放在 `$HOME/.config/opengridworks/weather-replay.env`（权限 `0600`），使用只读身份。如果 S3 端点仅服务器可访问，通过已有 SSH 入口将本机回环端口转发到服务器能访问的 S3 地址，将 `WEATHER_REPLAY_S3_ENDPOINT` 设为本机的转发地址，然后启动开发服务器。PostgreSQL 保存回放登记，云图和降水帧由对象存储提供，本地需要同时连通两者。

导入先读取并校验区域帧，再按内容哈希写入 SeaweedFS，回读验证后在一个 PostgreSQL 事务中登记文件和回放。相同版本的重复导入可安全重试。数据库智能体可通过只读 MCP 工具 `list_weather_replays` 核对案例、时间、帧数、峰值降水率、来源和版本，并返回固定版本的页面地址。智能体已有的普通气象问答当前仍查询登记过的 GFS 等指标。

语义目录迁移将红外亮温、瞬时降水率和累计降水估计写为草稿，供数据治理审核。现有导入器负责区域裁剪、坐标归一、单位转换、质量检查、对象存储分配和版本登记，使用受控的 `green_agent_ingest` 角色。数据库智能体可以检查回放发布的元数据，统一指标问答仍由已审核目录及对应查询服务控制。

首个案例按指定时间窗手动导入。持续抓取、滚动保留和自选区域生成属于后续扩展。

来源为 [SatWeave](https://developers.google.cn/weathernext/guides/satweave) 与 [PARDIG](https://developers.google.cn/weathernext/guides/pardig)，Google DeepMind 和 Google Research，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
