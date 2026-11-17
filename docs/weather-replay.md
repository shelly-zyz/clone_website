# 区域气象回放

使用气象地球顶部的五个入口切换全球气象场和四个区域分析视图。首个案例覆盖西北大西洋 23–35°N、80–64°W，使用 2026-09-26 09:00–15:00 UTC 的 7 帧 SatWeave 11.2 µm 红外亮温和 25 帧 PARDIG-NRT 地面降水率。采样间距为 0.2°，降水时间步长为 15 分钟。降水率由源数据的 m/h 转为 mm/h，缺测保持为空。红外使用不晚于当前降水帧的最近帧。

## 区域和场景

左栏「回放区域」由四个区域视图共用。点击地球上有档案覆盖的位置，可以直接打开该区域的历史回放。区域、时刻、选点在区域视图之间沿用，现有 `replay=weather|time|rain|accumulation` 链接仍可访问。

四个视图共用 Natural Earth 1:50m 边界和经纬度参照。沿海卫星档案的底图扩展至佛罗里达半岛和古巴。美国与巴哈马历史链接会高亮相应地形，并保留同一档案中的海上观测。

- **云雨结构**提供可调不透明度的云体、可选降雨粒子和可移动的东西向 A–B 剖面。右栏显示总云量或红外亮温与地面降水剖线。现有档案只提供二维网格，云体高度为示意。粒子密度表示降水率，浏览器的减少动态效果设置可冻结粒子。
- **降水时空演变**最多显示五张半透明切片。竖轴是 UTC 时间，间距按源时间戳计算。可用时间轴或右栏切片按钮切换当前帧。
- **降水热点追踪**将 ≥2.5 mm/h 的四邻接格点合成热点，按相邻帧的区域重叠和中心位移双向匹配。时间缺口会切断轨迹。地图显示雨区等值线、热点中心和选中热点轨迹，右栏展示覆盖面积、峰值、净位移与强度变化。
- **累计降水**用平面雨量着色、等值线和峰值标签展示结果。按档案时间步长对降水率做梯形积分，实际覆盖支持时可选过去 6、12 或 24 小时。缺测格点不参与统计，区域均值和阈值覆盖按实际格点面积计算。

## 渲染回归验证

运行 `node scripts/verify-weather-replay-geometry.mjs` 验证底图覆盖、内环、岛屿、沿海观测和等高雨滴。也可传入已下载的真实 API 响应 JSON 路径。该检查同时验证时间切片、轨迹断点、等值线缺测处理和累计时间窗。

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

## 气象地球与三维产品

`/workspace?topic=weather` 默认使用 [cambecc/earth](https://github.com/cambecc/earth) 的交互地球。左栏支持风、洋流、波浪及各自的覆盖指标，进入或切换时自动运行动画。GFS 地表风和 OSCAR 洋流显示各自的有效时刻。波浪使用 [NOAA GFS-Wave](https://www.nco.ncep.noaa.gov/pmb/products/wave/) 2022-03-22 00 UTC 起报的五个历史时次（06–18 UTC，每 3 小时一帧），以主波周期和方向绘制传播中的波峰，另有有效波高着色。档案由 0.25° 原场抽样至 1°，保留陆地及其他缺测掩膜。通过 `scripts/build-earth-waves.py` 可用 NumPy 与 PyGRIB 重新归档。

气象地球右侧的「空间对照」并排显示同一有效时刻的 ERA5 再分析与 NOAA GFS 历史预报，提供 T2m、U10、Z500 与 T850，每行使用相同的投影、空间范围和色标。对照使用独立的历史时轴，四个时次为 2022-03-22 06、12、18 UTC 和次日 00 UTC。左侧图层筛选、动画及投影控制气象地球。手机端可从地球下方展开空间对照。已有 `weatherMode=comparison` 链接进入合并后的页面，`weather` 与 `replay` 链接仍可恢复原地球状态和回放场景。

区域回放使用铺满视口的 Canvas 与悬浮控制、统计和色标，沉浸按钮进入浏览器全屏并隐藏侧栏与读数。云雨结构和时空演变支持拖动旋转。热点与累计地图支持拖动平移。各视图支持滚轮和双指缩放。

- 地区菜单由 `public/data/weather-replay/regional-catalog.json` 和原卫星档案生成。区域切换独立裁剪地理边界、请求档案、更新时间轴和读数。历史美国与巴哈马链接继续访问原覆盖区。
- NOAA GFS 历史模式预报提供中国东南沿海台风格美（2024-07-25）以及北美、南美、欧洲、亚洲、非洲和大洋洲（2022-03-22）的 06–18 UTC、每 3 小时一帧。使用地面瞬时降水率 PRATE（kg m⁻² s⁻¹ 转为 mm/h）和整层总云量 TCDC（%）。中国场景使用源 0.25° 网格，其他区域每隔一格取样至 0.5°。所有帧保留 NOAA 源链接和起报时间，累计为分段梯形积分。
- 使用 `scripts/build-regional-weather.py` 和 PyGRIB、NumPy 再生成 NOAA 文件。API 优先读取发布目录，未发布的已知 NOAA 案例可返回内置档案。带版本的 URL 只读取相应发布版本。具备发布环境后，先应用 `scripts/v11-weather-replay-rate.sql`，再通过 `node scripts/import-weather-replay.mjs public/data/weather-replay/gfs-*.json` 将归档注册到 PostgreSQL 和对象存储。该迁移放开旧卫星档案的 75 mm/h 数据库约束，保留原值。


### 固定档案与复核

- 全球对照源为 Copernicus 气候变化服务的 ERA5 再分析，经 [WeatherBench 2](https://weatherbench2.readthedocs.io/en/latest/data-guide.html) 提供，以及 [NOAA GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/) 历史 GRIB。归档中保留每帧 GFS 源文件地址。ERA5 数据包含经处理的 Copernicus Climate Change Service 信息。
- 再生成脚本为 `scripts/build-weather-comparison.py`，在独立 Python 环境执行，需要 NumPy、numcodecs、PyGRIB。
- 运行 `node scripts/verify-weather-science-archives.mjs` 和 `node scripts/verify-weather-replay-geometry.mjs public/data/weather-replay/atlantic-20260926.json` 复核有效时刻、数据覆盖、缺测和雨滴约束。
