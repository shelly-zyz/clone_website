# 气象区域 3D 回放

在气象地球右上角用缩略图切换全球风场、云雨叠加、降水时空层、降雨粒子和累计降水。首个案例覆盖西北大西洋 23–35°N、80–64°W，使用 2026-09-26 09:00–15:00 UTC 的 7 帧 SatWeave 11.2 µm 红外亮温和 25 帧 PARDIG-NRT 地面降水率。采样间距为 0.2°，降水时间步长为 15 分钟。降水率由源数据的 m/h 转为 mm/h，缺测保持为空。红外使用不晚于当前降水帧的最近帧。

## 区域和场景

左栏的「回放区域」由四个 3D 模式共用。底板使用项目内 Natural Earth 1:50m `ADM0_A3` 边界 `public/data/weather-replay/regions.geojson`（USA、BHS、BMU、CUB、CHN）。Polygon 的外环、内环保持分组，MultiPolygon 的岛屿分别填充；不再将所有环扁平化后用于裁剪数据。底板、海岸线与源格点共用经纬度投影及中心纬度比例校正。

国家内陆覆盖采用真实陆地轮廓；跨国、沿海档案保留数据覆盖范围的浅蓝色半透明海洋承载面，并叠加真实陆地。当前西北大西洋档案本身是矩形覆盖，因此其海洋支撑面保留矩形范围，不能把它虚构成国界形状。美国、巴哈马选择强调对应国界，同时保留该沿海档案的完整海上网格，区域峰值及累计读数也对应这个显示范围。中国没有已发布覆盖，显示完整地理轮廓与无数据提示，不挪用大西洋数据。

四种数据表现恢复自 `6d506a6` 之前的 `replay-canvas.ts`（最后修改为 `595f452`）。历史实现是 Canvas 的三维投影，不是体积云渲染；本次恢复其原始画法，不新增 Shader 或视觉体系：

- 云雨叠加恢复蓝色红外亮温网格、橙色降水柱及原始透明度、柱高与帧间插值。
- 降水时空层恢复最多五层、30 分钟取样、0.16 层距及完整数据承载面；每层保留海上降水和实际时间标签。
- 降雨粒子恢复原始 `ceil(sqrt(rate) * 1.35)` 密度、强度分组亮度、下落公式、透视和水花。保留时间轴暂停时持续下落及系统减少动态效果设置。
- 累计降水保留梯形积分及缺测语义，恢复原始两格曲面、`sqrt(value / maximum) * 0.65` 高度和 HSL 配色。色标上限同步当前帧累计最大值；不改变原始累计数据。

默认朝向 0.42、倾斜 0.39、画面占比及各模式垂直定位均恢复历史参数。现有旋转、缩放、复位、拖动、双指缩放、区域切换、播放与时间轴控件保留。

## 渲染回归验证

运行 `node scripts/verify-weather-replay-geometry.mjs` 使用固定输入验证；可传入真实 API 响应 JSON 的本地路径。该检查覆盖沿海网格不丢失、国界范围、内环和内环中的独立岛屿，并将四种模式的数据绘制操作（坐标、高度、颜色、粒子和时间层）与历史版本逐项比较。真实数据 JSON 不提交仓库。

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
