# 中国大屏预览：数据与占位来源映射

> 日期：2026-09-09  
> 目的：说明 HTML 中每个数字、状态和视觉对象来自哪里，防止预览被误读为运行中的生产大屏。

## 数据身份图例

- `官方统计`：正式年度汇总，可以显示原值，但不能推导小时曲线或设施坐标。
- `映射样本`：公开设施数据库中的已收录记录，不等于官方全量。
- `众包地图`：OSM 的几何和标签，不包含真实调度容量、损耗和潮流。
- `正式预报`：GFS 业务预报，不是站点实测；预览不固定展示一个可能已过期的起报时间。
- `研究估算`：GRACED、遥感足迹等真实发布的研究数据，不是监测值。
- `模型情景`：GFDL-ESM4 × SSP1-2.6 的长期情景，不是实际发电或超短期预测。
- `UI 示意`：只为确认布局、动效和交互，不是业务数据。
- `不可用`：当前缺少真实输入，必须保持空值或锁定。

## 预览对象逐项映射

| 预览对象 | 显示内容 | 身份 | 来源 | 预览限制 |
|---|---|---|---|---|
| 全国装机 | `3,348.62 GW` | 官方统计 | `public/data/china-validation/official-totals.json`；国家能源局 2024 全国电力工业统计 | 从 3,348,620 MW 格式化；年度汇总 |
| 全国发电量 | `10,086.88 TWh` | 官方统计 | 同一 JSON；国家统计局 2024 统计公报 | 从 10,086,880 GWh 格式化；不是小时功率 |
| 电源/电网投资 | `1,168.7 / 608.3 十亿元` | 官方统计 | 同一 JSON；国家能源局 | 金额，不等于装机或发电量 |
| 已映射设施 | `9,143` 条 | 映射样本 | `website_data.energy_assets`、`src/lib/china-map-data.generated.json` | 多来源公开样本，有重复与覆盖差异 |
| OSM 线路 | `199,001` 条 | 众包地图 | `public/data/osm-power/summary.json`；Geofabrik 中国 PBF 2026-05-17 | 几何条目，不是输电通道或实时潮流 |
| OSM 变电站 | `37,069` 条 | 众包地图 | 同上 | OSM 众包覆盖，不等于官方变电站全量 |
| OSM 电厂/发电机 | `14,644 / 753,493` | 众包地图 | 同上 | 发电机可能是细粒度组件，不能称电厂数 |
| 光伏足迹年份 | `2015 / 2020 / 2024` | 研究估算/遥感 | CPVPD-2024、ChinaPV 2015/2020 | 地图面在预览中不按真实坐标绘制；面积不换算 MW |
| VRE 时间范围 | `2021—2060`、`32×40×2` | 模型情景 | `public/data/climate-vre/manifest.json` | 只展示模式/情景与数据规模；趋势线形状为 UI 示意，不代表具体序列 |
| GRACED Power 范围 | `2019-01—2026-05` | 研究估算 | 当前 PG 与项目审计；Carbon Monitor GRACED | 预览不显示一个虚构的当前排放值 |
| GFS 节点 | “当前预报输入” | 正式预报/运行态 | `/api/weather-earth`、NOAA/NCEP GFS | standalone 文件不调用运行 API，因此显示“生产接入时读取真实状态” |
| 历史 NWP 节点 | “未通过” | 不可用 | `DATA_GAP_DOWNLOAD_PLAN_2026-09-08.md` | 当前只有少量模式批次，不能训练 |
| 实际功率节点 | “缺失” | 不可用 | 同上 | 不提供任何 15 分钟/小时风光真实标签值 |
| 六工位像素小人、设备和产物图 | 作业中/已产出/待机状态 | UI 示意 | HTML/CSS 与内联 SVG；交互模式参考 GitHub 的 Stix / AI Architecture Diagram，产物构图参考用户提供的超短期预测论文图 4—8 | 动画和小图代表界面流程，不代表后台任务或论文模型真的运行 |
| 模型、P10/P50/P90、误差 | 第 5/6 工位的锁定牌 | 不可用 | 路线图和 MVP 数据门槛 | 不绘制预测曲线、区间或误差数字 |
| 中国省级地形地图 | 省级边界、青绿/黄褐地貌、浮雕材质 | 视觉素材 | 用户指定的 `C:\Users\53472\Desktop\课程汇报\商务智能与仿真\coastal-grid-dashboard\public\data\china-full.json`、`china-terrain.jpg`、`china-relief.jpg`；预览副本位于 `assets/coastal-*` | 保留原始土地地貌色，不再使用单一蓝色滤镜；仍不是中国官方高精度审图边界或业务图层 |
| 地图光点、线路流光、网格 | 视觉层 | UI 示意 | HTML 内联 SVG/CSS | 不代表真实设施坐标、线路、容量或潮流；省级边界来自上述素材，不再使用手绘内部省界线 |
| 省份选择后的数量槽 | `—` 或范围说明 | 不可用/待生产查询 | Unit 4 只读数据契约 | 不在预览伪造省级样本数或官方统计 |
| 时间轴时刻 | `UI 演示 00—05` | UI 示意 | HTML 内部计时器 | 只验证同步 choreography，不代表真实时间序列 |

## 外部来源链接

- 国家能源局 2024 全国电力工业统计：<https://www.nea.gov.cn/20250121/097bfd7c1cd3498897639857d86d5dac/c.html>
- 国家统计局 2024 统计公报：<https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html>
- OpenStreetMap / Geofabrik 中国快照：<https://download.geofabrik.de/asia/china.html>
- WRI Global Power Plant Database：<https://datasets.wri.org/datasets/global-power-plant-database>
- GEM 电力设施数据：<https://globalenergymonitor.org/projects/global-integrated-power-tracker/>
- CPVPD-2024：<https://zenodo.org/records/15618227>
- ChinaPV 2015/2020：<https://zenodo.org/records/14292571>
- NOAA/NCEP GFS：<https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p50>
- Carbon Monitor GRACED：<https://carbonmonitor-graced.com/>
- GFDL-ESM4 SSP1-2.6 配套数据：<https://zenodo.org/records/20501729>
- Natural Earth 1:50m：<https://www.naturalearthdata.com/downloads/50m-cultural-vectors/>
- Stix（MIT，SVG 人物与 CSS 动画组织方式参考）：<https://github.com/bassimeledath/stix>
- AI Architecture Diagram（MIT，自包含 SVG 流程、数据包与步骤播放参考）：<https://github.com/devganeshg/ai-archi>
- dotLottie Web（MIT，已评估但本预览未引入，避免额外播放器/WASM 依赖）：<https://github.com/LottieFiles/dotlottie-web>

## 生产实现不可复制的内容

Unit 4 不得把 HTML 里的地形材质、光点、线路、时间序号、趋势线形状或省级空槽当作业务数据。生产页面可以参考已确认的省级三维视觉方向，但边界、设施、线路和业务值必须来自可审计的生产数据契约并携带来源元数据。
