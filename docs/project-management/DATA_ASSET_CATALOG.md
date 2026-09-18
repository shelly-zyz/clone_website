# 数据资产清单与真实数据替换表

> 全量来源补录（2026-09-03）：见[网站全部历史数据与来源清单](WEBSITE_DATA_SOURCE_INVENTORY.md)，包含本表此前未单列的在线底图、Natural Earth四种边界、旧版GFS/OSCAR样本，以及已停用演示数据的真实来源边界。数据库数量与迁移缺口已在2026-09-08重新现场核验。

> 核验日期：2026-09-18
> 原则：网站只展示可追溯的真实观测、正式统计或明确标注的模型/情景结果；没有数据时显示“暂不可用”，不生成假值。  
> 当前状态：新 PostgreSQL 数据库 `zyz` 已完成25张业务表的现场审计；核心数量、日期范围和部分字段缺失率以下方实测为准。9月8日文档中的18张表是历史快照，不再代表当前状态。逐项缺口、真实下载入口和人工操作要求见[2026-09-08数据缺口与下载计划](DATA_GAP_DOWNLOAD_PLAN_2026-09-08.md)；按气象/电力/碳地球解释“是什么、来源、用途”的版本见[分地球完整数据清单](EARTH_PROJECT_DATA_INVENTORY_2026-09-08.md)。

## 一、当前可确认的数据资产

| 数据名称 | 来源 | 时间范围 | 空间粒度 | 主要字段 | 单位 | 真假状态 | 更新方式 | 当前缺失率/质量结论 |
|---|---|---|---|---|---|---|---|---|
| 中国发电设施 | WRI Global Power Plant Database、Global Energy Monitor、China Hydropower Station Dataset、GloHydroRes | 多来源最新快照；GEM文件标注2026-02 | 设施点位 | ID、名称、技术、装机、状态、经纬度、来源、业主/运营方 | MW、经纬度 | 真实公开来源；不是官方全量名录 | 重新下载源表后运行`build-china-map-data.py` | 9,143条设施记录。存在跨源重复和口径差异；地图汇总总装机为官方总量的119.22%，不得直接称官方装机 |
| 中国数据中心/互联设施 | PeeringDB Facility API | 生成时快照 | 设施点位 | ID、名称、运营方、经纬度、审核来源和时间 | 经纬度；功率多数未知 | 设施与坐标有真实来源；不能把缺失功率补成估算值 | PeeringDB API重新获取 | 24条中国设施；真实电力容量基本缺失，不用于负荷计算 |
| 中国OSM电力基础设施 | OpenStreetMap中国PBF快照`china-260517.osm.pbf` | 2026-05-17快照 | 点、线 | OSM ID、名称、power标签、设施类型、电压、状态、几何 | kV、经纬度 | 真实众包地图数据 | 从Geofabrik/OSM更新PBF后重新提取 | 线路199,001、变电站37,069、电厂14,644、发电机753,493；字段缺失与重复尚未形成百分比审计 |
| 光伏足迹 | CPVPD-2024、ChinaPV 2015/2020 | 2015、2020、2024 | 光伏多边形/面积 | 足迹几何、年份、省份、面积 | m²或源数据面积单位 | 真实遥感/论文数据 | 更新论文数据或归档后重建 | CPVPD读取11,636条、当前筛选使用856条；足迹面积不得换算为真实装机MW |
| 官方全国电力统计 | 国家能源局、国家统计局 | 2024 | 全国汇总 | 分类型装机、发电量、电源/电网投资 | MW、GWh、亿元 | 官方真实统计 | 每年更新正式公报 | 只有全国汇总，缺省级和设施坐标；仅用于校验地图口径 |
| NOAA GFS近实时预报 | NOAA/NCEP NOMADS | 当前库52条、13个指标；最新起报2026-09-18 02:00、有效时间05:00（北京时间） | 全球0.5° | 10m/100m风、阵风、温湿度、CAPE、气压、降水、积雪、辐射等13项 | m/s、°C、%、J/kg、hPa、mm、W/m²等 | `forecast`正式业务预报，不是站点实测 | `sync-live-weather.mjs`下载、校验、入库；Windows任务每小时检查 | 2026-09-18已回收失效锁并完成13字段端到端同步，批次13行、空载荷0；仍需连续运行24小时验收计划任务稳定性 |
| GRACED Power碳排放 | Carbon Monitor/GRACED | 2019-01-01—2026-05-31 | 全球0.1°日栅格 | 日期、部门、栅格、统计量、源档案哈希 | kgC/h | 真实研究数据产品，不是地面逐点实测 | GRACED公开接口下载；本地脚本处理 | 新库2,708日帧，空帧0、非法单位0；2026-09-08本机访问官方月份API仍失败 |
| GRACED其他部门 | Carbon Monitor/GRACED | 目标2019-01—2026-04 | 全球0.1°日栅格 | total、Industry、GroundTransportation、Residential、Aviation、Shipping | kgC/h | 真实研究数据产品 | 公开接口下载 | 本地仅发现少量total等scratch材料，不能认定完整；需重新盘点或下载 |
| GFDL-ESM4 SSP1-2.6风光容量因子 | Chen等论文/Zenodo，本地MAT文件 | 2021—2060逐小时 | 中国0.5° | 时间、网格、风/光容量因子 | 0—1容量因子 | 真实发布的模型情景结果；不是历史观测和实际未来发电 | Zenodo重新下载或使用本地5.84GB MAT源文件 | MAT源文件及2,563个派生JSON在本地，可重建`climate_vre_hourly`；装机映射口径未校准，不能当实际发电量 |
| 五变量气候投影NetCDF | Zenodo记录20501729；变量`rsds/sfcwind/tas/huss/ps` | 2021-01-01—2060-12-31 | 源网格及项目日帧 | 辐照、近地风速、气温、比湿、气压 | 各变量原始单位 | `model_scenario`真实发布模型数据，不是观测 | 服务器20个原始NetCDF保留；按导入脚本重建 | 新库20源、5变量、73,050日帧；帧级缺失值记录0，大小与官方MD5及逐文件日期/网格已验收 |
| GISPO可再生能源潜力 | GlobalRenewableEnergyResource/GISPO，ERA5 2019 | 源年份2019 | 源0.25°，项目聚合0.5° | `lon,lat,region,grid,annual_cf,cap_poten,max_cf` | 容量因子、GW | 真实公开研究数据 | GitHub源CSV下载；聚合脚本导入 | 四类源CSV共773,653行；新库四类聚合共222,943条，核心值域和地区/网格缺失0 |

## 二、关键缺失数据

| 数据名称 | 当前状态 | 缺失率判断 | 对产品的影响 |
|---|---|---:|---|
| 各省分类型、分年份官方装机 | 缺失 | 接近100% | 不能制作可信的省级装机排名和历史趋势 |
| 各省/场站15分钟或小时真实风光出力 | 缺失 | 100% | 不能训练或验证超短期发电功率预测 |
| 带发布时间和有效时间的历史NWP预报档案 | 当前只有2个GFS模式批次；近实时自动刷新已建立 | 接近100% | 当前预报可展示，但仍不能支撑预测训练或防止“事后天气”泄漏 |
| 各省小时负荷 | 缺失 | 100% | 不能做负荷曲线、供需缺口和真实日前负荷预测 |
| 省间通道容量、损耗、成本和真实潮流 | 只有地图几何/电压 | 调度字段接近100% | 可展示线路，不能进行真实跨区调度 |
| 储能功率、容量、效率和SOC | 缺失 | 100% | 不能进行储能调度 |
| 分省、分电源排放因子 | 2023省级平均CO2排放因子官方PDF已下载但未结构化；分电源碳足迹因子另有官方公告 | 历史年份和小时粒度仍接近100%缺失 | 可补2023静态省级平均展示，生产侧/消费侧动态碳排放仍暂缓 |
| WFDE5/W5E5/ERA5历史气象 | 截图论文使用陆地WFDE5小时基准，并以陆地WFDE5＋海洋ERA5的W5E5体系校正ISIMIP未来情景；当前均未下载，需要CDS账号/许可/Token | 100% | 复现论文中国陆地历史基准应优先WFDE5；ERA5只按额外变量、海洋或独立验证需求补充，避免重复下载 |
| 多GCM、多SSP、多成员气候情景 | 当前只有单一GFDL-ESM4 SSP1-2.6 | 主要组合缺失 | 只能展示单情景，不能表达模式不确定性 |

## 三、数据库与恢复能力

- 当前新库 `zyz` 可登录，共25张业务表；Power、气候、VRE、GISPO、设施、OSM、边界、预测与GFS核心查询均已现场执行。
- 服务器现有约1.04 GB完整备份是气候导入前基线，17表隔离恢复测试通过；它不能代表当前23 GB数据库。
- 气候导入后的新完整备份尚未生成；计划先在服务器本地备份、验档、隔离恢复，再复制到华为家庭存储同步盘并比对SHA-256。
- 2026-09-08客户端跨网 `pg_dump` 在约524MB时因服务器关闭连接失败，PostgreSQL随后重启；失败报告和`.part`保留但不算备份。重启后核心业务表、Power 2,708日、total 31日和气候73,050帧重新核验仍在。
- 华为家庭存储客户端已安装，但系统尚未发现已启用的同步盘目录；用户需在客户端开启同步盘后才能执行异机复制。
- 需重新下载或补采：缺失GRACED部门、ERA5、历史NWP、省级负荷/风光出力/调度/储能，以及土地、坡度、保护区和多模式气候数据。
- 逐项迁移证据见`DATA_MIGRATION_AUDIT_2026-09-01.md`、`DATA_GAP_DOWNLOAD_PLAN_2026-09-08.md`及工作区外审计JSON。

## 四、删除假数据后的真实替代来源

| 已删除/停用的假数据 | 推荐真实来源 | 下载入口 | 我能否直接处理 | 限制 |
|---|---|---|---|---|
| 自动生成的全球电站 | Global Energy Monitor Global Integrated Power Tracker；WRI Global Power Plant Database | https://globalenergymonitor.org/projects/global-integrated-power-tracker/ ；https://datasets.wri.org/dataset/globalpowerplantdatabase | 能下载公开文件并转换；需要确认各源许可和版本 | 多来源重复、状态和装机口径必须去重 |
| Demo全球数据中心及虚构功率 | PeeringDB Facility API；OpenStreetMap `man_made=data_center`等标签 | https://www.peeringdb.com/apidocs/ ；https://download.geofabrik.de/ | 能自动下载公开坐标 | PeeringDB主要覆盖对外服务设施；多数设施没有真实MW容量，不能估算填充 |
| Demo输电线和变电站 | OpenStreetMap/Geofabrik；OpenInfraMap | https://download.geofabrik.de/asia/china.html ；https://openinframap.org/ | 中国PBF已在本地，可重新处理；其他地区可按需下载 | 众包数据不保证完整；线路几何不等于可调度容量 |
| Demo天然气管线 | Global Energy Monitor Global Gas Infrastructure Tracker | https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/ | 公开下载可由我转换 | 数据许可、下载表单和版本需核对 |
| Demo海底光缆和登陆点 | TeleGeography Submarine Cable Map | https://www.submarinecablemap.com/ | 技术上可下载公开接口数据 | 公开地图数据通常含CC BY-NC-SA等限制，商业用途前必须确认许可 |
| 合成天气场 | NOAA/NCEP GFS NOMADS | https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p50 | 已有自动下载脚本，可直接刷新 | NOMADS有短期保留和访问频率限制；历史训练需另建归档 |
| 虚构负荷、发电和跨区潮流 | 省级交易中心、电网公司、中电联、国家统计局或获授权数据 | https://data.stats.gov.cn/ 以及各交易中心数据门户 | 公开文件可协助下载；登录、验证码、协议或付费数据需要用户操作 | 全国统一的长期省级小时数据通常不公开 |

## 五、真实性验收规则

1. 每条业务数据必须有`source`、来源链接/文件、数据时间和真实类型标签。
2. 类型只能是：`observed`真实观测、`official_stat`官方统计、`forecast`正式预报、`model_scenario`模型情景；不再允许`mock`或`sample`。
3. 数据不可用时接口返回空结果或503，页面显示原因，不生成曲线、地图点或统计值。
4. 地图设施汇总与官方统计必须分栏展示，不能把地图覆盖率差异伪装成官方数值。
5. 所有预测必须携带训练数据范围、模型版本、生成时间、预测时效和回测指标。
