# 网站全部历史数据与来源清单

> 整理日期：2026-09-03  
> 适用项目：通用能源数据与分析平台，主站为 `ai-website-cloner-template`。  
> 用途：回答“网站曾经用过什么数据、从哪里来、存在哪里、迁移时怎么办”。  
> 证据范围：当前代码、导入脚本、生成文件、旧版 `public/earth/` 页面、Git HEAD中的历史Mock文件、项目记录及本次公开来源检索。不是运行中服务器的数据库审计。  
> 不包含与项目无关的课程简易数据包，也不把论文中提到但本项目未取得的数据冒充成“已使用”。

## 1. 先看懂状态

| 状态 | 含义 |
|---|---|
| 已接入/有本地文件 | 代码或生成文件能证明接入过；不等于今天线上接口可用 |
| 历史入库、本地缺失 | 有历史导入证据，但目前没有完整本地恢复文件 |
| 在线调用 | 网站通过第三方地图服务加载，不能视为已经完整下载 |
| 已下载、未正式启用 | 本地有材料，但没有完成业务图层或计算接入 |
| 历史演示/已停用 | 曾显示过的手写或生成内容，不能作为真实数据重新导入 |
| 仅规划/待获取 | 为后续预测、调度或AI准备，尚未证明实际接入 |

这里的“真实”需要细分：官方统计、众包地图、研究估算、业务预报、模型情景都可以有可信来源，但彼此不能混称“实测”。文件存在也不等于全国覆盖完整。

本地路径以下以主站仓库为起点；`../data/`是主站同级的数据目录，`../supplement data/`是补充材料目录。现有源文件和备份结论沿用2026-09-01逐文件审计；本轮进一步核对了代码接入与来源，未重做全部大文件哈希，也未连接PG。

## 2. 电力设施、光伏足迹和正式统计

| 编号 | 数据名称/发布者 | 来源链接 | 网站实际用途和主要字段/单位 | 本地文件、版本及状态 |
|---|---|---|---|---|
| E01 | Global Power Plant Database / WRI | [WRI下载页][wri]；[源仓库](https://github.com/wri/global-power-plant-database) | 中国电站点位、燃料类型、名称、业主、经纬度、装机MW；煤、气、核、水等多类型资产基础 | `../data/globalpowerplantdatabasev130.zip`，v1.3.0；已接入、有源档案 |
| E02 | Global Solar Power Tracker / GEM | [太阳能数据页][gem-solar] | 光伏/光热项目、状态、装机MW、投运年、GEM ID、业主/运营方、坐标 | `../data/gem-data.zip`内2026-02太阳能表；已接入 |
| E03 | Global Wind Power Tracker / GEM | [风电数据页][gem-wind] | 陆上/海上风电项目、状态、装机MW、投运年、GEM ID、业主/运营方、坐标 | 同上压缩包内2026-02风电表；已接入 |
| E04 | China Hydropower Station Dataset | [Mendeley候选对应记录][china-hydro]；[原下载对象](https://prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com/1292710f-0650-45a4-b77f-f7fbe8207353) | 中国水电站、河流/流域、水库、水头、装机、年发电量等；单位按源字段 | `../data/China Hydropower Station Dataset.zip`；2,918条源记录，有源档案。新找到的公开记录题名和条数匹配，但本地档案与其具体版本仍待哈希对应 |
| E05 | GloHydroRes | [Zenodo 14526360][glohydro] | 补充水电站及水库属性；对已有中国水电站做属性补全和去重 | `../data/14526360.zip`；源文件名含`vs1`，公开记录版本标为v2，二者不要混为一个版本标签 |
| E06 | CPVPD-2024光伏足迹 | [Zenodo 15618227][cpvpd] | 2024光伏空间范围、面积、省份；面积m²；不把面积直接换算为装机MW | `../data/CPVPD-2024.zip`；已用于足迹汇总，非完整交互多边形图层验收 |
| E07 | ChinaPV 2015光伏足迹 | [Zenodo 14292571][chinapv] | 2015历史光伏足迹、面积、省份 | `../data/14292571.zip`内`ChinaPV_2015_v1.1`；有源文件，1,645条源足迹汇总 |
| E08 | ChinaPV 2020光伏足迹 | [同一Zenodo记录][chinapv] | 2020历史光伏足迹、面积、省份 | 同一ZIP内`ChinaPV_2020_v1.1`；有源文件，10,985条源足迹汇总；源面积单位尚需按原说明复核 |
| E09 | PeeringDB Facility | [原始设施API][peering-api]；[API说明][peering-doc] | 中国数据中心/互联设施名称、运营方、城市、坐标、状态、更新时间；没有可信MW就留空 | 生成文件保留24条；原始全量API响应未保存，需重新获取 |
| E10 | PeeringDB缺坐标人工审核表 | [上游PeeringDB][peering-api]；逐行运营商官网保存在CSV | 保存未通过坐标筛选的设施，不通过猜测坐标和功率补齐 | `docs/research/opengridworks/peeringdb-cn-manual-review.csv`；不是新独立数据集；`review_source`等为空的行尚未完成审核 |
| E11 | OSM中国输电线路/电缆 | [Geofabrik中国下载][osm-download]；[OSM版权/署名][osm-license] | `power=line/cable`、OSM ID、名称、电压、状态、几何；电压kV | `../data/china-260517.osm.pbf`，2026-05-17快照；派生`china-power-lines.geojson`，199,001条 |
| E12 | OSM中国变电站 | [同一中国PBF][osm-download] | `power=substation`、名称、电压、类型、几何/中心点 | 同一PBF；派生`china-power-substations.geojson`，37,069条 |
| E13 | OSM中国电厂 | [同一中国PBF][osm-download] | `power=plant`、名称、燃料、输出标签、状态、几何/中心点 | 派生`china-power-plants.geojson`，14,644条；不可与E01—E05直接相加 |
| E14 | OSM中国发电机组/设施 | [同一中国PBF][osm-download] | `power=generator`、燃料、发电方式、输出标签、几何/中心点 | 派生`china-power-generators.geojson`，753,493条；很多是细粒度组件，不是753,493座电厂 |
| E15 | 2024全国分电源装机 / 国家能源局 | [原始统计公报][nea-2024] | 全国水电、火电、核电、风电、光伏装机；源万kW，项目转MW | `public/data/china-validation/official-totals.json`；脚本录入官方表，用作总量校验，无设施坐标 |
| E16 | 2024全国发电量 / 国家统计局 | [原始统计公报][nbs-2024] | 全国总量和分电源发电量、清洁能源发电量；源亿kWh，项目转GWh | 同一`official-totals.json`；官方统计，不是小时真实功率序列 |
| E17 | 2024电源/电网工程投资 / 国家能源局 | [同一能源局公报][nea-2024] | 电源与电网投资；源亿元，JSON字段为十亿元人民币 | 同一`official-totals.json`；不要把投资当作装机或发电量 |
| E18 | 2024全国电力可靠性年度报告 / 国家能源局、中电联 | [原PDF下载][reliability] | 可靠性和运行基准背景，不是电站坐标来源 | `../supplement data/2024 National Power Reliability Annual Report.pdf`；已下载、元数据被引用，未证明全文指标已入库 |
| E19 | Aqueduct Floods沿海洪水栅格 / WRI | [原下载目录][aqueduct] | `inuncoast_historical_nosub_hist_rp0005_0.tif`；历史沿海洪水风险候选层，约0.008333° | `../supplement data/`中有TIF；`coastal-risk-candidate.json`记为采样跳过、暴露记录0、默认不渲染；具体数值单位应按该产品说明核验 |

### 电力数据口径提醒

- 当前生成的能源资产为9,143条、PeeringDB设施为24条，不是全国官方完整名录。
- 源处理记录：WRI读取4,235/使用1,135；GEM太阳能17,756/4,513；GEM风电10,569/3,932；中国水电2,918/1,138；GloHydroRes中国相关938/新增18，另有属性补全。不能把“各源使用条数”简单相加作为去重后的电站数。
- GEM及水电导入存在容量与状态筛选；CPVPD读取11,636条，当前汇总筛选使用856条。筛选掉的不是“缺失数据”，也不代表全国完整覆盖率。
- 主站`china-map-data.generated.json`中的`gridLines`和`substations`当前是空数组；真正的中国线路、变电站由OSM GeoJSON/矢量瓦片路径提供。
- 全国官方装机与地图样本装机必须分开；地方统计未接入就不能生成官方省级排名。

## 3. 气象：网站实际使用的13项GFS指标

共同来源：[NOAA/NCEP NOMADS GFS 0.5°下载][gfs]。代码：`scripts/update-weather-earth-data.mjs`、`scripts/decode-gfs-grib.py`、`src/lib/weather-earth.ts`。  
本地：`.weather-cache/`；历史表：`website_data.weather_forecast_fields`。当前盘点保留的是2026-07-26 12:00 UTC起报、15:00 UTC有效的一次快照，不是实时全历史档案。

| 编号 | 指标 | 源变量/高度 | 网站单位 | 来源 |
|---|---|---|---|---|
| W01 | 10米风场 | UGRD、VGRD；10m | m/s，向量 | [GFS][gfs] |
| W02 | 2米气温 | TMP；2m | °C，源K转换 | [GFS][gfs] |
| W03 | 2米相对湿度 | RH；2m | % | [GFS][gfs] |
| W04 | 对流有效位能 | CAPE；地表 | J/kg | [GFS][gfs] |
| W05 | 海平面气压 | PRMSL | hPa，源Pa转换 | [GFS][gfs] |
| W06 | 整层可降水量 | PWAT；整层大气 | kg/m² | [GFS][gfs] |
| W07 | 100米风场 | UGRD、VGRD；100m | m/s，向量 | [GFS][gfs] |
| W08 | 阵风 | GUST | m/s | [GFS][gfs] |
| W09 | 累计降水 | APCP | mm | [GFS][gfs] |
| W10 | 积雪深度 | SNOD | m | [GFS][gfs] |
| W11 | 地面气压 | PRES；地表 | hPa，源Pa转换 | [GFS][gfs] |
| W12 | 地表向下短波辐射 | DSWRF | W/m² | [GFS][gfs] |
| W13 | 2米比湿 | SPFH；2m | kg/kg | [GFS][gfs] |

更新方式是重新下载正式GFS预报并解码；必须保留起报时间、有效时间和累计/平均区间。旧快照“字段齐全”不等于“时效有效”，缺失率应分字段缺测和时间覆盖分别统计。

代码记录的GRIB筛选接口：`https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p50.pl`，查询参数由脚本根据日期、变量和高度生成，不应固定复制旧日期下载链接。

## 4. 长期气候与风光情景

### 4.1 五个气候变量：20个NetCDF

共同入口：[Zenodo记录20501729][climate-zenodo]；[对应论文][vre-paper]。这是2021—2060的GFDL-ESM4、SSP1-2.6模型情景，不是真实未来观测。

| 编号 | 变量 | 含义/单位（按项目导入记录） | 时间、空间和文件 | 当前恢复状态 |
|---|---|---|---|---|
| C01 | `rsds` | 地表向下短波辐射，W/m² | 逐小时；0.5°有效点；2021—2060，每10年1文件，共4个 | 2026-09-08当前新PG实测入库14,610日帧；服务器4个原始NC保留；[下载][climate-zenodo] |
| C02 | `sfcwind` | 近地风速，m/s | 同上，共4个 | 当前新PG实测入库14,610日帧；服务器4个原始NC保留；[下载][climate-zenodo] |
| C03 | `tas` | 近地气温，°C | 同上，共4个 | 当前新PG实测入库14,610日帧；服务器4个原始NC保留；[下载][climate-zenodo] |
| C04 | `huss` | 近地比湿，kg/kg | 同上，共4个 | 当前新PG实测入库14,610日帧；服务器4个原始NC保留；[下载][climate-zenodo] |
| C05 | `ps` | 地表气压，Pa | 同上，共4个 | 当前新PG实测入库14,610日帧；服务器4个原始NC保留；[下载][climate-zenodo] |

实际结构是`time × location`，共有3,848个有效位置，不是每个经纬格点都有数据；项目记录时区为UTC+08。当前新PG已重新核验73,050个日块，即5变量×14,610天，每个日块内含24小时数据；覆盖2021-01-01—2060-12-31，缺失值帧0。

证据：`docs/research/climate-projection-gfs-integration.md`、`scripts/import-zenodo-climate-projection.py`、`../outputs/20260904-climate-model-selection/server-status.json`和`full-import-verification.json`。20个文件合计21,524,120,425字节，官方MD5、登记大小、逐文件日期范围、日数、变量单位、单一网格和导入状态已通过；这些仍是公开模型情景，不是未来实测。

### 4.2 容量因子与按装机换算的发电情景

| 编号 | 数据 | 来源 | 网站用途/字段 | 本地位置与限制 |
|---|---|---|---|---|
| C06 | 风电容量因子`CF_Wind` | [本地下载记录17445329][vre-download]；[脚本中的DOI入口15832921][vre-doi]；[论文][vre-paper] | 2021—2060逐小时，0—1；全国/省级风电情景 | `../data/VRE_gfdl-esm4_ssp126_2021_2060.mat`约5.84GB；有源文件 |
| C07 | 光伏容量因子`CF_PV` | [同一MAT下载记录][vre-download]；[论文][vre-paper] | 同期逐小时，0—1；全国/省级光伏情景 | 与C06同一文件；经纬索引为`lon_lat_of_VRE_output` |
| C08 | 区域小时功率、发电量、年度摘要 | C06/C07＋E01—E05地图已投运装机；[作者方法代码][vre-code] | 容量因子、功率MW、发电量GWh、年统计 | `public/data/climate-vre/`，32区域×40年×风/光共2,560组，加总清单等2,563个JSON；属于派生情景，不是实测发电 |

来源记录中有三个Zenodo编号：15832921（构建脚本DOI）、17445329（本地MAT下载记录）、20501729（后续气候文件目录）。应全部保留，按文件名与哈希确认是否同文件/不同版本，不应把旧目录中将MAT也写成20501729的内容当作唯一原始下载证据。

部分沿海/边界格点在构建时使用邻近行政区分配，`manifest.json`记录了`fallbackAssignedGridCount`。这是需要披露的空间分配方法，不是实测省界匹配。固定现有装机换算未来40年的发电量只是一种情景假设。

## 5. GISPO可再生能源装机潜力

来源：[GlobalRenewableEnergyResource作者仓库][gispo]。四类源CSV基于ERA5 2019年，源0.25°，项目聚合0.5°；不是2026年的真实剩余可开发装机。主要字段为`lon, lat, region, grid, annual_cf, cap_poten, max_cf`，容量因子无量纲，潜力容量按源说明为GW。

| 编号 | 数据名称 | 直接下载 | 本地源文件 |
|---|---|---|---|
| P01 | 分布式光伏潜力 | [dpv CSV](https://raw.githubusercontent.com/mrziheng/GlobalRenewableEnergyResource/main/VREPotential/dpv_attr_era5_cell_2019.csv) | `../data/gispo-vre-potential/dpv_attr_era5_cell_2019.csv` |
| P02 | 集中式光伏潜力 | [upv CSV](https://raw.githubusercontent.com/mrziheng/GlobalRenewableEnergyResource/main/VREPotential/upv_attr_era5_cell_2019.csv) | `../data/gispo-vre-potential/upv_attr_era5_cell_2019.csv` |
| P03 | 陆上风电潜力 | [onshore CSV](https://raw.githubusercontent.com/mrziheng/GlobalRenewableEnergyResource/main/VREPotential/onshore_attr_era5_cell_2019.csv) | `../data/gispo-vre-potential/onshore_attr_era5_cell_2019.csv` |
| P04 | 海上风电潜力 | [offshore CSV](https://raw.githubusercontent.com/mrziheng/GlobalRenewableEnergyResource/main/VREPotential/offshore_attr_era5_cell_2019.csv) | `../data/gispo-vre-potential/offshore_attr_era5_cell_2019.csv` |

四类合计773,653个源单元，本地源文件已补回；历史聚合222,943条入`website_data.renewable_resource_potential`。容量可求和，容量因子不能直接求和。已入库不代表装机潜力/调度专用页面已经验收。

## 6. GRACED碳排放：全部8种代码支持的部门

共同来源：[Carbon Monitor/GRACED][graced]；脚本查询`https://carbonmonitor-graced.com/api/data/month`取得每月档案链接。请求需部门等参数，来源页本身不是单个NetCDF的直链。

共同粒度：全球0.1°日帧；项目保存/显示单位`kgC/h`，不是`kgCO₂/h`。项目日总CO₂换算为小时碳质量乘24再乘44/12；仅在源单位和时间口径核验一致时适用。

| 编号 | 部门键 | 中文含义 | 接入证据与本地备份现状 | 来源 |
|---|---|---|---|---|
| G01 | `Power` | 电力 | 碳地球核心已接入；2019-01—2026-04共88个月、2,677日帧完整；2026-05另有31帧scratch待并入 | [GRACED][graced] |
| G02 | `total` | 总排放 | 历史回填/界面支持；本地仅发现2019-02、2021-03两个零散月份，非完整备份 | [GRACED][graced] |
| G03 | `Industry` | 工业 | 有部门入口和回填路线；当前本地未找到完整源文件，数据库现存范围未知 | [GRACED][graced] |
| G04 | `Residential` | 居民部门 | 同上 | [GRACED][graced] |
| G05 | `GroundTransportation` | 地面交通 | 同上；不自动等于“全部交通” | [GRACED][graced] |
| G06 | `DomesticAviation` | 国内航空 | 有部门入口；当前本地未找到完整源文件，数据库现存范围未知 | [GRACED][graced] |
| G07 | `InternationalAviation` | 国际航空 | 本地仅发现2024-06一个月scratch；非完整备份 | [GRACED][graced] |
| G08 | `InternationalShipping` | 国际航运 | 有部门入口；当前本地未找到完整源文件；部分旧文档简称Shipping | [GRACED][graced] |

GRACED是公开研究排放估算产品，不是逐点监测仪器读数。其他部门“存在代码支持/历史任务”不能推出全部日期均已完成导入。

主要位置：`../data/carbon-graced/{raw,work,processed}/Power/`；零散材料在`../data/carbon-graced-scratch/`、`carbon-graced-restore-scratch/`、`carbon-graced-minscratch/`。保留原压缩包、解压NetCDF、逐日帧和manifest，不能只留页面热力图。

## 7. 地图边界、影像、在线底图与字体

### 7.1 本地行政边界

共同来源：[Natural Earth 1:50m官方页][natural-earth]；[项目引用的GeoJSON仓库][ne-github]。比例尺1:50m指1:5,000万，不是50米空间分辨率。

| 编号 | 数据 | 本地文件/网站用途 | 来源链接 |
|---|---|---|---|
| M01 | 国家/地区面 | `public/data/natural-earth/ne_50m_admin_0_countries.geojson`；国家点击、轮廓、着色 | [GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson) |
| M02 | 国家陆地边界线 | 同目录`ne_50m_admin_0_boundary_lines_land.geojson` | [GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson) |
| M03 | 州/省行政区面 | 同目录`ne_50m_admin_1_states_provinces.geojson`；省份筛选、VRE聚合 | [GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_1_states_provinces.geojson) |
| M04 | 州/省边界线 | 同目录`ne_50m_admin_1_states_provinces_lines.geojson` | [GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson) |
| M05 | 国家中心点/标签和地区范围配置 | `src/lib/country-centers.generated.json`、`src/lib/map-data.ts`和页面中的标签配置 | 项目派生/手工配置；外部独立来源未单独记录，应连同M01—M04和代码迁移；不是人口或经济统计 |

Natural Earth是通用制图资料；中国正式发布地图还需单独核对边界表达与适用要求，不应当作官方高精度省界。

### 7.2 当前代码中存在的在线底图调用

| 编号 | 数据/发布者 | 来源页或实际服务 | 年份/用途/限制 |
|---|---|---|---|
| M06 | NASA VIIRS CityLights | [NASA GIBS示例与说明](https://github.com/nasa-gibs/gibs-web-examples)；实际模板见下 | 代码固定`VIIRS_CityLights_2012`、2012-01-01，夜间灯光影像；不是实时用电或实时卫星图 |
| M07 | CARTO Dark栅格底图 | [CARTO公开样式](https://github.com/CartoDB/basemap-styles)；`https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`和`dark_nolabels` | 暗色地图；深海、纯黑等主题复用同源，只是样式不同 |
| M08 | CARTO矢量底图 | [实际TileJSON](https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json) | 道路、地名等；TileJSON是瓦片目录，不是完整地图数据包 |
| M09 | EOX Sentinel-2 cloudless | [EOX预览/来源](https://s2maps.eu/)；实际模板见下 | 代码指定2020无云影像拼接层，不是实时卫星观测 |
| M10 | Esri World Imagery | [ArcGIS图层页](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)；[实际服务](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | 全球卫星/航空影像拼接；不同区域成像时间不同，不应统一标同一年 |
| M11 | Open Infrastructure Map在线矢量瓦片 | [OpenInfraMap说明](https://openinframap.org/about)；`https://openinframap.org/20250311/{z}/{x}/{y}.mvt` | 页面使用的外部地图服务，底层主要来自OSM；不同于本地中国PBF提取的电网瓦片 |
| M12 | MapLibre在线字形 | `https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf`；[MapLibre项目](https://github.com/maplibre/demotiles) | 地图文字的显示资源，不是业务数据；没有本地完整字体瓦片备份证据 |

NASA实际模板：

```text
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg
```

EOX实际模板：

```text
https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg
```

这些地址来自当前代码，记录地址不等于本轮逐张瓦片请求成功。在线影像和商业底图不可默认整站爬取、镜像或离线复制；迁移时先保留调用配置与署名，再按服务许可决定缓存范围。

**特别纠正：** `mapThemes`里的“GOES / Himawari”仅是主题名称，实际仍调用CARTO `dark_nolabels`。没有真实GOES或向日葵卫星数据接入证据，不应写成已拥有该数据。

## 8. 旧版earth页面保留的数据

这些文件仍在主站`public/earth/`目录，页面代码也存在`/earth/index.html`嵌入入口。因此不能因它们来自旧参考项目而遗漏；但也不能作为新的实时数据。

| 编号 | 数据 | 来源链接 | 本地证据/状态 |
|---|---|---|---|
| L01 | 旧版GFS 1°近地风场 | [原earth项目](https://github.com/cambecc/earth)；[NOAA GFS资料](https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast) | `public/earth/data/weather/current/current-wind-surface-level-gfs-1.0.json`；文件头为2014-01-31 00:00 UTC起报、预报3小时、10m U/V；真实历史样本，文件名current不代表今天 |
| L02 | OSCAR 1/3°海表流场 | [原earth项目](https://github.com/cambecc/earth)；[NASA PO.DAAC历史产品入口](https://podaac.jpl.nasa.gov/dataset/OSCAR_L4_OC_third-deg) | `public/earth/data/oscar/20140131-surface-currents-oscar-0.33.json`及`catalog.json`；2014-01-31、U/V、m/s；单期历史样本，不是当前海流。NASA旧入口现有迁移跳转，重下需查产品版本 |
| L03 | 旧地球地理拓扑 | [Natural Earth][natural-earth]；[原earth项目](https://github.com/cambecc/earth) | `public/earth/data/earth-topo.json`、`earth-topo-mobile.json`；旧地球海岸/边界绘制，精确源发布版本未记录 |

旧页面代码支持其他气象变量和日期，不代表这些变量/日期的文件已经下载。字体、图标和旧页面库保留在`public/earth/styles/`、`public/earth/libs/`，作为显示依赖，不列作新的气象数据源。

## 9. 网站自己生成的文件：必须迁移，但不是新的外部来源

| 派生资产 | 上游数据 | 主要位置 | 迁移说明 |
|---|---|---|---|
| 中国设施合并结果 | E01—E05、E09 | `src/lib/china-map-data.generated.json` | 保留来源ID、筛选/去重规则，不能拿派生文件替代源表 |
| 光伏足迹汇总 | E06—E08 | `public/data/china-pv/solar-footprints-summary.json` | 是汇总，不等于全部多边形已上屏 |
| 官方统计/覆盖校验/风险候选 | E15—E19及设施合并结果 | `public/data/china-validation/` | 覆盖比是校验结果，不是另一个官方数据 |
| OSM四类GeoJSON与电网瓦片 | E11—E14 | `public/data/osm-power/` | 同一数据的不同显示格式，不能重复统计资产数 |
| 主干/详细输电预览 | E11 | `china-transmission-preview.geojson`、`china-transmission-detail-preview.geojson` | 由真实OSM线段筛选、分组/简化生成，可能抽样；不是完整可调度拓扑 |
| VRE区域时序及摘要 | C06—C08、M03 | `public/data/climate-vre/` | 时间、装机基准、格点分配方法一起保留 |
| GFS解码/量化缓存 | W01—W13 | `.weather-cache/` | GRIB、解码JSON和指标缓存同源；记录单位换算和缺测编码 |
| GRACED逐日帧/统计/清单 | G01—G08 | `../data/carbon-graced/processed/`和各scratch | 保留日期、部门、单位、网格和原始档案链接 |
| 数据目录和导入日志 | 以上所有源/脚本 | `dataset_catalog`、`source_files`、`import_runs`及本地记录 | 描述“数据怎么来”，不是新的能源数据集 |
| 搜索、筛选、当前区域总量 | 设施合并结果和地图状态 | `src/lib/map-data.ts`、`MapAppShell.tsx` | 动态计算结果，无独立下载链接；输出应保留筛选条件和来源 |

## 10. 以前用过、后来停用的演示数据

证据来自Git HEAD的`src/lib/mock-map-data.ts`、当前`src/lib/map-data.ts`及2026-08-25清理记录。这一节是历史留档，不是建议恢复清单。即使演示记录写了真实机构名称，也不能据此认定下载过该机构的正式数据库。

| 历史内容 | 旧标签/来源情况 | 现在状态及真实替代入口 |
|---|---|---|
| 全球随机/密集生成电厂 | `Seeded global mock`、`Mock plant registry`；无真实来源 | 当前主站入口已停用；需要重新接入[WRI][wri]、[GEM太阳能][gem-solar]、[GEM风电][gem-wind]等 |
| 手写海外电厂、储能/核电/抽蓄等点位 | 多种`Demo*`；部分写有`EIA 860/860M`但未发现源表导入链 | 已停用；EIA真实替代：[EIA-860](https://www.eia.gov/electricity/data/eia860/)、[EIA-860M](https://www.eia.gov/electricity/data/eia860m/)，不能把旧手写MW当真实数据 |
| 手写海外数据中心/互联网交换中心及功率 | `Mock PeeringDB`、`DemoCloud`、`Epoch AI`、`IM3/PNNL`等标签 | 已停用；这些标签没有已核验的原始数据链接；PeeringDB真实设施见E09，真实耗电功率仍缺 |
| 手写/生成变电站、输电线 | `hifldSubs`、`rowSubs`、`osmSubs`等标签，不是实际HIFLD源文件证明 | 手写入口已清除；保留真实OSM路径。标签菜单仍存在，不代表HIFLD/ROW已重新接入 |
| 自定义输电走廊及规划升级项目 | 手写几何，`OGF`标签；无可核验规划数据库 | 当前`plannedUpgrades`为空；不恢复成真实规划项目 |
| 天然气管线 | `Demo gas` | 当前`gasPipelines`为空；候选替代[Global Gas Infrastructure Tracker](https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/)尚未证明接入 |
| 海底光缆、登陆点及光纤相关演示 | 手写PC-1/BRUSA及Demo cable，部分标`TeleGeography`；没有完整原始导入链 | 当前`submarineCables`和`landingPoints`为空；真实替代[Submarine Cable Map](https://www.submarinecablemap.com/)，下载/商业使用前需核许可 |
| 合成天气场 | 历史`weather-earth-sample.ts`生成，无真实观测来源 | 已删除合成入口；保留GFS真实预报与2014历史样本，两者均须标日期 |

前端停用并不证明旧云PG里所有演示行已经删除；PG无法登录时只能把数据库内残留状态记为“待核验”，重新建库时按真实源清单重新导入。

## 11. 只在规划或候选目录出现、尚未真正接入的数据

为了不遗漏过去讨论过的来源，单独列出，但以下不得计入“网站已有真实数据”。

| 数据 | 已保存的来源入口 | 当前用途/缺口 |
|---|---|---|
| ERA5 2015—2019 10m/100m风与历史气象 | [Copernicus CDS](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels) | 未下载；用于真实历史基准和风切变，需账号/Token |
| WFDE5 1979—2019历史小时气象 | [DOI 10.24381/cds.20d54e34](https://doi.org/10.24381/cds.20d54e34) | 未下载；是气候论文方法的上游参考，不等于网站已经拥有 |
| ISIMIP3b/其他GCM、SSP、成员 | [ISIMIP数据门户](https://data.isimip.org/) | 没有独立原始多模式档案；不能把当前单模式结果说成多模式集合 |
| 中国省级小时负荷 | 电网/省级交易中心/用户授权文件；具体数据集链接未确定 | 没有全国长期统一小时数据源，不能以国家统计局年统计替代 |
| 场站15分钟/小时实测风光功率、停机/可用率 | 场站、电网和授权接口；具体链接未确定；宏观统计候选[国家数据](https://data.stats.gov.cn/) | 超短期预测训练和验收的关键缺口 |
| 分省分电源装机历史 | [GEM综合项目](https://globalenergymonitor.org/projects/global-integrated-power-tracker/)及官方统计 | 现有设施表仅部分支持；完整官方省级时序未接入 |
| 省间通道容量、阻抗、损耗、成本、检修和实际潮流 | 电网/交易中心；原始数据链接未确定 | OSM的电压/几何不能代替这些字段 |
| 储能功率、容量、效率、SOC | 业主/电网授权；原始链接未确定 | 未接入，不用演示值补齐 |
| 分省分电源排放因子 | 官方发布/研究资料，具体口径与数据集尚未确定 | GRACED总排放不是可直接替代的排放因子 |
| 土地覆盖、海拔、坡度、保护区、海域及输电距离 | 论文补充资料候选；[NetZero2050方法仓库](https://github.com/mrziheng/NetZero2050) | 方法参考不是本项目已下载的完整地理约束包 |
| 负荷驱动：人口、GDP、产业结构、节假日 | [国家数据](https://data.stats.gov.cn/)；节假日具体公报未登记 | 气温已有，其他连续省级特征未入库；程序日历属于确定性派生 |
| Data Center Map补充坐标审核 | [Data Center Map](https://www.datacentermap.com/)及运营商官网 | 只在PeeringDB审核建议中出现；尚无已完成逐条审核证据 |

AI/GeoIR、Text-to-SQL金标准、语音音频、模型训练集和论文私有风场样本没有已接入网站的数据证据，不应在迁移清单中标记为已有资产。

## 12. PostgreSQL存储映射：数据进了哪些表

下列为`scripts/database-schema.sql`的17张表；前缀均为`website_data.`。这是结构和脚本映射，不是当前数据库行数证明。

| 表名 | 对应数据/用途 |
|---|---|
| `import_runs` | 导入批次、状态和日志元数据 |
| `source_files` | 源文件目录、路径与校验信息 |
| `json_documents` | 目录、统计、摘要等JSON文档 |
| `energy_assets` | E01—E05整合能源设施 |
| `data_centers` | E09 PeeringDB设施 |
| `geo_features` | OSM、Natural Earth等地理要素 |
| `vector_tiles` | 本地OSM显示瓦片
` | C06—C08风光小时情景 |
| `dataset_catalog` | 数据资产来源、获取状态和用途目录 |
| `renewable_resource_potential` | P01—P04聚合装机潜力 |
| `weather_forecast_fields` | W01—W13 GFS运行/字段 |
| `climate_projection_sources` | C01—C05文件级来源、范围、哈希 |
| `climate_projection_grids` | 气候投影有效点/网格元数据 |
| `climate_projection_daily` | 气候变量按天组织的小时数据块 |
| `carbon_source_archives` | G01—G08源月档案 |
| `carbon_emission_frames` | GRACED日帧与统计 |
| `carbon_emission_frame_chunks` | 碳帧分块存储 |

**没有完整本地PG备份。** 结构脚本不是数据备份；`carbon-psql-direct-last.sql`也只有1条碳源档案和1帧数据。新的服务器必须按源文件重建，再核验每表行数、日期和缺失率。

## 13. 迁移时怎么用这份清单

1. 原样保留现有源文件、清单、脚本和派生文件；不因“能再下载”就删除旧版本。
2. 可本地恢复的优先复制：Power、VRE MAT、GISPO、能源ZIP、OSM PBF、光伏ZIP、边界和派生文件。
3. 必须补下载的优先登记：20个气候NetCDF、缺失GRACED部门/月份、PeeringDB原始JSON、最新GFS。
4. 在线底图只迁移配置、署名和合法缓存策略；未经许可不把整站瓦片“全部下载”。
5. 对每项记录：来源链接、下载日期、源版本、文件哈希、时间/空间范围、字段/单位、许可、缺测率、派生方法、目标服务器路径、目标PG表。
6. 文件缺失率、字段缺测率、日期覆盖率和全国覆盖率分别统计；未知写“未核验”，不要统一填0%。
7. 完成导入后再做真实数据模块验收；历史演示/候选数据不能混入真实业务表。

补充：本轮没有数据下载、服务器部署、数据库写入、文件删除或Git提交。来源网页抽查有成功、限流和超时三种结果；不能把部分Zenodo本轮未打开理解为数据不存在。

## 14. 核验依据与本轮发现

- 电力、统计、足迹：`scripts/build-china-map-data.py`、`src/lib/china-map-data.generated.json`及`public/data/china-validation/`、`public/data/china-pv/`。
- OSM：`scripts/build-china-osm-power-data.py`、`scripts/build-china-transmission-preview.mjs`及`public/data/osm-power/summary.json`。
- 气象：`scripts/update-weather-earth-data.mjs`、`src/lib/weather-earth.ts`。
- 气候/VRE：`scripts/build-climate-vre-data.py`、`scripts/import-zenodo-climate-projection.py`、`public/data/climate-vre/manifest.json`和MAT下载记录。
- 潜力：`scripts/import-renewable-resource-potential.py`和四个本地CSV。
- 碳：`scripts/sync-carbon-graced.py`、`src/lib/carbon-earth.ts`和2026-09-01迁移审计。
- 在线底图：`src/lib/map-data.ts`、`src/components/opengridworks/MapAppShell.tsx`。
- 历史earth：`public/earth/about.html`、`public/earth/libs/earth/1.0.0/products.js`及两个历史数据文件头。
- 演示来源：Git HEAD中的`src/lib/mock-map-data.ts`；仅阅读，没有恢复旧文件。
- 新补齐：全部在线底图、四种边界、旧版GFS/OSCAR/地理拓扑、来源标签与真实导入的区别。
- 来源待进一步精确对应：Mendeley中国水电具体版本；三个Zenodo编号的文件级关系；部分遥感面积/洪水单位；国家中心点生成来源。
- 本轮找到的[Mendeley记录][china-hydro]与本地中国水电题材及2,918条规模匹配；[GloHydroRes记录][glohydro]区分了发布版本v2与文件名vs1。均已把不确定性保留在清单中。

[wri]: https://datasets.wri.org/datasets/global-power-plant-database
[gem-solar]: https://globalenergymonitor.org/projects/global-solar-power-tracker/
[gem-wind]: https://globalenergymonitor.org/projects/global-wind-power-tracker/
[china-hydro]: https://data.mendeley.com/datasets/j529pxw9p8/3
[glohydro]: https://zenodo.org/records/14526360
[cpvpd]: https://zenodo.org/records/15618227
[chinapv]: https://zenodo.org/records/14292571
[peering-api]: https://www.peeringdb.com/api/fac
[peering-doc]: https://docs.peeringdb.com/api_specs/
[osm-download]: https://download.geofabrik.de/asia/china.html
[osm-license]: https://www.openstreetmap.org/copyright
[nea-2024]: https://www.nea.gov.cn/20250121/097bfd7c1cd3498897639857d86d5dac/c.html
[nbs-2024]: https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html
[reliability]: https://prpq.nea.gov.cn/uploads/file1/20250331/67ea4fb889529.pdf
[aqueduct]: https://wri-projects.s3.amazonaws.com/AqueductFloodTool/download/v2/index.html
[gfs]: https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p50
[climate-zenodo]: https://zenodo.org/records/20501729
[vre-download]: https://zenodo.org/records/17445329
[vre-doi]: https://doi.org/10.5281/zenodo.15832921
[vre-paper]: https://www.nature.com/articles/s41597-025-06396-5
[vre-code]: https://github.com/RuijieChen-123/Convert_climate_variable_to_VRE_generation
[gispo]: https://github.com/mrziheng/GlobalRenewableEnergyResource
[graced]: https://carbonmonitor-graced.com/
[natural-earth]: https://www.naturalearthdata.com/downloads/50m-cultural-vectors/
[ne-github]: https://github.com/nvkelso/natural-earth-vector
