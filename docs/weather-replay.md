# 气象区域 3D 回放

在气象地球右上角用缩略图切换全球风场、云雨叠加、降水时空层、降雨粒子和累计降水。首个案例覆盖西北大西洋 23–35°N、80–64°W，使用 2026-09-26 09:00–15:00 UTC 的 7 帧 SatWeave 11.2 µm 红外亮温和 25 帧 PARDIG-NRT 地面降水率。采样间距为 0.2°，降水时间步长为 15 分钟。降水率由源数据的 m/h 转为 mm/h，缺测保持为空。红外使用不晚于当前降水帧的最近帧。

## 区域和场景

左栏的「回放区域」由四个 3D 模式共用。底板使用项目内 Natural Earth 1:50m `ADM0_A3` 边界 `public/data/weather-replay/regions.geojson`（USA、BHS、BMU、CUB、CHN）。Polygon 的外环、内环保持分组，MultiPolygon 的岛屿分别填充；不再将所有环扁平化后用于裁剪数据。底板、海岸线与源格点共用经纬度投影及中心纬度比例校正。

四种模式共用带经纬度网格和刻度的地理参照底图。沿海档案的底图向陆地方向延伸，以显示佛罗里达半岛和古巴等地标。陆地填灰蓝色并描绘海岸线，海域使用淡色，底图扩展仅用于地理参照。美国和巴哈马选择高亮相应边界，同时保留原始档案的陆上与海上观测。中国显示真实轮廓和无已发布覆盖的提示。

- 云雨叠加用蓝色红外亮温网格和动态雨滴同时显示云与降水。降雨粒子视图单独显示雨幕。
- 两种雨幕从同一场景高度连续落下，雨滴统一速度、长度与亮度。降水率仅控制每个格点的粒子密度。暂停时间轴时雨滴继续下落，浏览器减少动态效果设置会冻结雨滴。
- 降水时空层最多显示五层，按 30 分钟取样，各层保留海上降水和实际时间标签。
- 累计降水使用梯形积分，保留格点缺测，以高度和颜色显示累计量。

## 渲染回归验证

运行 `node scripts/verify-weather-replay-geometry.mjs` 验证底图覆盖、内环、岛屿、沿海观测和等高雨滴。也可传入已下载的真实 API 响应 JSON 路径。该检查还按原数据视口对比红外纹理、降水时空层及累计高度场的历史绘制结果。

## 导入和读取

1. 在已经应用对象登记表迁移 `scripts/v11-file-object.sql` 的 `zyz` 数据库依次执行 `scripts/v11-weather-replay.sql` 和 `scripts/v11-weather-replay-semantics.sql`。
2. 在同一数据库应用 [回放内容表迁移](../scripts/v11-weather-replay-payload.sql)。通过本机受限环境文件提供 `WEATHER_REPLAY_MIGRATION_DATABASE_URL`（能切换到 `green_ddl`）和 `DATA_AGENT_INGEST_DATABASE_URL`（能切换到 `green_agent_ingest`），运行 `node scripts/backfill-weather-replay.mjs --migrate`。已应用迁移时省略 `--migrate`。脚本逐字节核验已有发布记录，重跑不会重复写入。可追加其他已登记版本的 JSON 文件路径。
3. 新数据使用 Node.js 24 或以上运行 `node scripts/import-weather-replay.mjs`。导入连接仍使用 `DATA_AGENT_INGEST_DATABASE_URL`，`WEATHER_REPLAY_S3_*` 对应的 S3 身份须能读写 `raw` 桶。Web 进程使用 `DATA_AGENT_DATABASE_URL`。调用 `GET /api/weather-replay` 或附加 `id`、`version` 读取已登记案例。ETag 是原始内容的 SHA-256，`X-Weather-Replay-Source: postgres` 表示完整帧由 PostgreSQL 返回。
4. 在 `/workspace?topic=weather` 打开区域回放，验证播放、时间轴、图层开关、视图切换及视角旋转。数据缺失或暂时不可用时，页面提供重试。

本地预览运行 `npm run check:preview` 后打开页面，检查 PostgreSQL、四地球所用数据及小云语音。若地址不同，传入实际的回环 URL。回填后增加 `--require-postgres-replay` 核实数据库直读，并在浏览器完成各地球首次渲染、四种回放视图与时间轴的检查。

旧版登记可使用只读 S3 身份，其配置放在 `$HOME/.config/opengridworks/weather-replay.env`（权限 `0600`）。已随站点提供的西北大西洋档案通过登记的同一 SHA-256 校验；数据库迁移期间或连接短时中断时，接口返回同版本资料并标记 `X-Weather-Replay-Source: bundled-archive`。显式指定未知版本时仍按对应发布登记读取。

导入先读取并校验区域帧，再按内容哈希写入 SeaweedFS，回读验证后在一个 PostgreSQL 事务中登记文件和回放。相同版本的重复导入可安全重试。数据库智能体可通过只读 MCP 工具 `list_weather_replays` 核对案例、时间、帧数、峰值降水率、来源和版本，并返回固定版本的页面地址。智能体已有的普通气象问答当前仍查询登记过的 GFS 等指标。

语义目录迁移将红外亮温、瞬时降水率和累计降水估计写为草稿，供数据治理审核。现有导入器负责区域裁剪、坐标归一、单位转换、质量检查、对象存储分配和版本登记，使用受控的 `green_agent_ingest` 角色。数据库智能体可以检查回放发布的元数据，统一指标问答仍由已审核目录及对应查询服务控制。

首个案例按指定时间窗手动导入。持续抓取、滚动保留和自选区域生成属于后续扩展。

来源为 [SatWeave](https://developers.google.cn/weathernext/guides/satweave) 与 [PARDIG](https://developers.google.cn/weathernext/guides/pardig)，Google DeepMind 和 Google Research，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
