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

运行 `node scripts/verify-weather-replay-geometry.mjs` 验证底图覆盖、内环、岛屿、沿海观测和等高雨滴。也可传入已下载的真实 API 响应 JSON 路径。该检查同时验证红外与降水纹理的缺测掩膜、时间切片和累计色标。

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

## 气象地球与三维产品

`/workspace?topic=weather` 的默认气象地球显示 ERA5 再分析与 NOAA GFS 历史预报对照。页面提供 T2m、U10、Z500 与 T850，在 2022-03-22 的 6、12、18 和 24 小时预报有效时刻同步更新。每行的投影、范围和色标一致。数据按 3° 网格显示，Z500 从 ERA5 位势换算为位势米。原全球图层可通过左栏切换，已有 weather 哈希链接仍打开原图层。

区域回放保留现有 `replay` 和版本链接，新增选点与同一时间轴的详情。四个区域回放视图使用不透明的浅色底板，深灰线标出海岸、边界和经纬刻度。降水率采用米黄至深红的固定 `mm/h` 色标，云的垂直显示位置用于示意。降水时空层使用同一区域的真实时间帧，各格点以等厚实色体素绘制，层距对应 30 分钟。累计降水的颜色与曲面高度以完整档案的固定尺度显示。平滑只用于绘制，读数和归档值使用原格点。默认案例在数据服务不可用时可读取内置 CC BY 4.0 历史档案，界面标注来源；指定 id 或版本的请求仍读取发布服务。

- `replay=radar` 使用 2022-03-22 12:01:25 UTC 的 NOAA KHGX Level II 体扫。Py-ART 生成水平 2 km、垂直 1 km 的三维反射率网格。回波体从该网格抽取 20、35、50 dBZ 等值面。可选两点形成 A–B 剖面，切换二维读图与三维位置，也可查看同一体扫的不同海拔切片。缺测保留掩膜。
- `replay=wind` 使用 NCAR WRF 3.8.1 的墨西哥湾历史样本。U、V、W 从交错网格转至质量点，高度从位势求得，三维箭头和右栏风速同步。右栏 WRF 10 米风速取同一运行的区域格点均值。在预报服务存在同区、同起报、同有效时刻记录时，ClimaX 选项显示匹配的 10 米风速。

### 固定档案与复核

- 全球对照源为 Copernicus 气候变化服务的 ERA5 再分析，经 [WeatherBench 2](https://weatherbench2.readthedocs.io/en/latest/data-guide.html) 提供，以及 [NOAA GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/) 历史 GRIB。归档中保留每帧 GFS 源文件地址。ERA5 数据包含经处理的 Copernicus Climate Change Service 信息。
- 雷达源为 [NOAA NEXRAD Level II KHGX](https://arm-doe.github.io/pyart/examples/io/plot_nexrad_data_aws.html)，风场源为 [NCAR WRF 公开样本](https://github.com/xarray-contrib/xwrf-data/blob/7a6100a48ee1b39a3fce3465e4da9e2c2a53cf6c/data/mercator_sample.nc)。衍生归档包含源 SHA-256。
- 再生成脚本为 `scripts/build-weather-comparison.py`、`scripts/build-weather-radar.py` 和 `scripts/build-weather-wind.py`。在独立 Python 环境执行，全球对照需要 NumPy、numcodecs、PyGRIB；雷达需要 Py-ART 和 scikit-image；WRF 需要 netCDF4 和 NumPy。雷达、WRF 脚本接收原文件与输出路径。
- 运行 `node scripts/verify-weather-science-archives.mjs` 和 `node scripts/verify-weather-replay-geometry.mjs public/data/weather-replay/atlantic-20260926.json` 复核有效时刻、数据覆盖、缺测、等值面拓扑、风场坐标和雨幕约束。
