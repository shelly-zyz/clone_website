# 四专题补充数据入库与语义目录

本轮按气象、电力、碳、经济核对用户提供的七组来源。逐数据集的时间、空间、单位、格式及入库状态见 [四专题补充数据清单](./v11-supplemental-dataset-inventory.md)。覆盖基线来自项目代码及既有验收记录。正式 `zyz` 无法连接期间，实际基线和正式入库状态需要在服务器复核。Beads 追踪 `ogw-22p.9.91`。

## 来源与缺口

| 来源 | 专题与用途 | 核验结果及接入位置 |
| --- | --- | --- |
| `D:\10.19数据集\carbon databases` | 碳。先按文件确认排放、碳价、因子或栅格等实际产品，检查与既有 GRACED 和 OECD 碳贸易重叠 | 只有服务器路径，待通过 `/mnt/d/10.19数据集/carbon databases` 或 Windows 侧确认。先采集相对路径、大小、哈希、格式、版本及授权，再提取气体、部门、口径、单位、时空粒度。现有碳产品仍沿用各自的事实表。 |
| [中国能源转型政策 v1](https://doi.org/10.6084/m9.figshare.32182515.v1) | 电力、碳及经济的政策研究 | 本机已导入 7,223 个逐条政策 ID 和 62,496 条分类计数。国家、省级、地级三个层级共 1,736 个地区年度、36 个标签和小计字段。分类计数按生效日，地方表含 2025 年记录。多个标签可以来自同一政策，分类次数不能当作独立政策数。下载的 Stata 代码显示中央汇总段引用了部分 `local` 输入，层级比较需核实。 |
| [Global Renewables Watch v1.0](https://github.com/microsoft/global-renewables-watch/releases/tag/v1.0) | 电力。全球陆上风机和商业光伏的卫星检测及季度分布 | 两个 GeoPackage 与 GitHub 发布 SHA-256 一致。风机 375,197 条，光伏 86,345 条，其中 5 条空几何保留且有标记。README 的光伏数为 86,410。原文件几何为 EPSG:3857，使用 WKB 和 SRID，保留原发布国家标签、地类及其他字段。建设季度是推断值，2017Q4 可能包含此前已建成设施。 |
| [夜间灯光推算的 1 km 用电量及实际 GDP v1](https://doi.org/10.6084/m9.figshare.17004523.v1) | 电力的空间用电密度和经济的空间产出 | 两份 ZIP 各有 1992–2019 的 28 个年包，合计 6,182,719,292 字节。整包与发布方 MD5 一致，全部年度包通过 CRC，56 个栅格头已在本机数据库登记。1992–2013 为 36,080 × 15,515，2014–2019 为 36,080 × 15,517，均为 World Mollweide 1,000 米浮点栅格，NoData 约 −3.402823 × 10³⁸。论文报告用电单位 kWh、实际 GDP 为 2017 年不变价百万美元。正式 SeaweedFS 与 V11 对象目录待连通。 [论文](https://doi.org/10.1038/s41597-022-01322-5) |
| [中国城市发电及电力部门 CO₂ 估算 v1](https://doi.org/10.6084/m9.figshare.30338773.v1) | 电力与碳共用一张城市年度事实表 | 352 个城市 × 20 年，7,040 条。保留源六位行政区划代码、英文城市名、工作簿行号和原单位。发电量为亿千瓦时，排放量为万吨 CO₂。研究用 PSO-BP 估算城市发电量，以 2021 年省级电力排放因子计算 2000–2019 年排放。 [论文](https://doi.org/10.1038/s41597-026-07484-w) · [计算代码](https://doi.org/10.6084/m9.figshare.30338803) |
| [Awesome Public Datasets](https://github.com/awesomedata/awesome-public-datasets) | 多专题来源索引 | 电力的全球电厂库可补电厂坐标和容量，先与 OSM 资产核对。经济地球已用 World Bank WDI 的 GDP、人均 GDP、出口额，其他序列按指标代码检查。气象可对照 NOAA 地面站日观测与 Copernicus 再分析。碳相关条目先与服务器原始目录去重。 [WRI 全球电厂库](https://datasets.wri.org/datasets/global-power-plant-database) · [NOAA GHCN-Daily](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc%3AC00861) · [Copernicus 气候数据](https://cds.climate.copernicus.eu/datasets) |
| [Global Weather Data](https://global-weather-data.com/) | 气象。城市历史天气、城市预报、格点预报 | 网站公开提供产品介绍并显示下载额度及分档，匿名打开城市历史下载入口会显示账户登录。取得样本后需核验底层来源及版本、时区、变量和入库使用条件。城市历史观测或再分析可补 GFS/WRF/ClimaX 预报和既有回放的时间维度。 |

## 已核对的数据产品与字段

**能源政策**。原始 ZIP 与 Figshare v1 的 MD5 一致，归档 CRC 通过。按清洁能源、能源革命、能源结构、能源转型、绿色能源、新能源、可再生能源七组检索词，分别提供中央和地方的详细清单、目标和工具分类、政策正文，以及 Stata 中间结果。详细清单包含 `gid`、标题、发文字号、公布和施行日期、时效性、制定机关和效力位阶等。分类表包含目标与工具的主类和子类，可筛减排、能效、电力转型、碳定价、财政金融和绿色产业。论文报告 7,295 份文本。附件内 7,308 个正文文件对应 7,223 个不同的 `gid`，其中 82 个 ID 出现在多个检索词目录，分类 CSV 可匹配其中 7,221 个 ID，6,551 个 ID 的分类字段有值。本机已导入逐条元数据、多标签和年度汇总，保留 `gid × 检索词` 关系、日期原文、分类来源和原正文归档路径。 [政策论文](https://doi.org/10.1038/s41597-026-08370-1) · [Figshare 发布包](https://doi.org/10.6084/m9.figshare.32182515.v1)

**风光设施**。风机数据到单台点位，可按国家、首次识别季度和原地类统计台数。光伏到场站多边形，可统计空间分布和面积。附件另带风机的局部 UTM 字段及光伏的来源图层、原 `area` 字段。论文的伴随产品包括按国家推算的装机量，所核对的两个 GeoPackage 未提供逐站实测 MW 或 MWh 字段。`landcover_in_2018` 来自 2018 年地类基准，可用于设施与地类叠加，性质是固定年度的参考。2017Q4 表示已在序列起点识别到，新增量分析需与 2018Q1 后的首次识别分开。 [GRW 方法与使用说明](https://arxiv.org/html/2503.14860v1)

**夜间灯光栅格**。论文的实际 GDP 覆盖 175 个国家或地区，用电量覆盖 134 个。未覆盖地区在产品中被填成 0。应与 GeoTIFF 的 NoData 哨兵值及覆盖内的真实零分开，区域汇总附覆盖范围。用电量模型采用 2015 年基准，2016–2019 年结果标记为模型延伸估算。两个产品分别对应经济地球与电力地球，产品内单位和覆盖不能互换。 [栅格论文](https://doi.org/10.1038/s41597-022-01322-5)

**城市电力碳**。工作簿公开城市地理代码、城市名、年份、发电量和电力部门 CO₂ 两项指标。论文使用的城市用电量及经济等解释变量没有在这份工作簿中作为观测字段交付。样本含地级市、自治州等，论文覆盖中国大陆 30 个省级地区，未含西藏。MATLAB 文件随版本引用，用作计算证据。 [城市电力碳论文](https://doi.org/10.1038/s41597-026-07484-w) · [计算代码](https://doi.org/10.6084/m9.figshare.30338803)

**Global Weather Data**。站点 FAQ 说明三个产品。城市历史为 ERA5 再分析点序列，声称覆盖逾 12,000 个居民地、逐小时、可追溯逾十年。可提取 2 米气温及露点、10 米和 100 米风、降水、积雪、辐射、土温和土壤含水量。城市预报与格点预报为 ECMWF 数值预报，预报上限为 15 天，支持逐小时和每天四次滚动更新。城市序列通过 CSV 或 API，格点入口支持 NetCDF 或 API。站点 FAQ 给出预报最高空间分辨率，公开项目介绍另给出格点 API 的 0.25°。格点入库以响应坐标和 NetCDF 头实测分辨率，时序同时校验起报、有效时、时间步及辐射和降水累计窗口。三个产品的说明已核对，样本仍待登录或使用已授权 API。 [站点 FAQ](https://global-weather-data.com/) · [公开产品介绍](https://dev.to/uniquezhiyuan/global-weather-datakai-yuan-mian-fei-de-quan-qiu-qi-xiang-shu-ju-ku-open-source-free-global-weather-database-5ao3) · [Copernicus 原始 ERA5 目录](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels)

### 多主题索引筛选结果

| 专题 | 具体产品与补充指标 | 核验状态 |
| --- | --- | --- |
| 气象 | NOAA GHCN-Daily 的站点日最高／最低气温、降水，用于实测对照。Copernicus ERA5 单层逐小时可补格点风、温度和辐射。 [NOAA 数据说明](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc%3AC00861) · [ERA5 产品](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels) | NOAA 首批导入 2024 年中国站点并保留观测质量码。ERA5 待和项目现有回放时空范围去重。 |
| 电力 | WRI 全球电厂库提供 `gppd_idnr`、坐标、容量 MW、燃料、投运年、业主和部分年度发电量 GWh，来源报告值和模型估算值分别留存。 [WRI 发布页](https://datasets.wri.org/datasets/global-power-plant-database) | 官方 v1.3.0 已校验并在本机导入 34,936 行、167 个国家代码。2019 年发电字段约 72% 为空。正式导入时核对现有 OSM 和 GRW 资产的覆盖。 |
| 碳 | World Bank 的 EDGAR 国家和地区年度序列。`EN.GHG.CO2.MT.CE.AR5` 对应不含土地利用、土地利用变化与林业的 CO₂，`EN.GHG.ALL.MT.CE.AR5` 对应同边界的全部温室气体。 [CO₂ 指标](https://data.worldbank.org/indicator/EN.GHG.CO2.MT.CE.AR5) · [温室气体指标](https://data.worldbank.org/indicator/EN.GHG.ALL.MT.CE.AR5) | 两项指标 1970–2024 年数据均已本机导入，保留经济体、地区聚合和缺测。与 GRACED 电力日格网、OECD 隐含碳贸易和城市电力碳分别使用。服务器碳目录仍待核对重叠。 |
| 经济 | Harvard Atlas 按经济体、贸易伙伴或商品编码及年份提供贸易结构，并可分析商品复杂度。HS 1992 序列自 1995 年起，可补目前 WDI 总出口额的商品维度。 [Atlas 下载与分类说明](https://atlas.hks.harvard.edu/data-downloads) | 固定 v18.0 的双边年汇总与两位商品章文件，校验源哈希。按商品编码版本保留同源进口、出口，六位双边商品明细保留为独立产品。 |

## 数据模型与运行方式

- `catalog.supplemental_source` 按实际导入文件的 SHA-256 存源版本、网址、许可说明、预期行数和语义说明。`semantic.supplemental_dataset_catalog` 按专题展开同一来源，跨专题共享事实数据。元数据使用现有 `green_agent_ro` 角色读取，MCP 使用 `list_supplemental_catalog` 和可选的 `topic`。`draft` 表示经过导入验证、仍待 V11 业务发布。
- `standard.supplemental_city_power` 使用源文件、城市代码、统计年作为主键。`standard.supplemental_policy_counts` 使用源文件、行政层级、地区代码、生效年和标签编码。`standard.supplemental_renewable_feature` 使用源文件及源 FID。地图处理可用 `ST_GeomFromWKB(geometry_wkb, srid)`，排除 `geometry_is_empty` 后仍应检查拓扑及范围，再生成空间索引或瓦片。
- 栅格按 `dataset_id × version × variable × year` 登记对象 URI、SHA-256、栅格宽高、CRS、分辨率、范围、NoData、单位与数据身份证明。应保留源年度包和可读取的地理产品。区域汇总作为可追溯派生产品写入数据库，使用明确的边界版本和栅格汇总算法。
- 城市天气用源城市键、时间戳、变量及产品版本定位。预报另存起报时间，历史记录区分观测和再分析。保留 UTC 和源站时区、原单位、质量码及缺测。

导入脚本用固定发布校验和校验输入，再在一个 PostgreSQL 事务内导入。重复运行用既有源版本和主键收敛，末尾复核每个源文件落库数量。现有 V11 问数发布目录和默认数据集可继续使用。

准备 Python 3.10 以上、`openpyxl`、`pandas` 和 `psql`。使用现有受限连接配置指向 `zyz`，登录需要具备 `SET ROLE green_ddl` 权限。输入目录按下表命名。

| 输入名 | 原始下载项 |
| --- | --- |
| `city.xlsx` | [城市工作簿](https://figshare.com/ndownloader/files/58663324) |
| `national.dta` / `provincial.dta` / `prefecture.dta` | [国家](https://ndownloader.figshare.com/files/64283241) / [省级](https://ndownloader.figshare.com/files/64283253) / [地级](https://ndownloader.figshare.com/files/64283250) |
| `wind.gpkg` / `solar.gpkg` | [风机](https://github.com/microsoft/global-renewables-watch/releases/download/v1.0/wind_all_2024q2_v1.gpkg) / [光伏](https://github.com/microsoft/global-renewables-watch/releases/download/v1.0/solar_all_2024q2_v1.gpkg) |
| `policies.zip` | [逐条政策数据源包](https://ndownloader.figshare.com/files/64282698) |
| `wdi-CO2.json` / `wdi-ALL.json` / `wdi-regions.json` | [CO₂ 观察值](https://api.worldbank.org/v2/country/all/indicator/EN.GHG.CO2.MT.CE.AR5?format=json&date=1970:2024&per_page=20000) / [全部温室气体](https://api.worldbank.org/v2/country/all/indicator/EN.GHG.ALL.MT.CE.AR5?format=json&date=1970:2024&per_page=20000) / [地区元数据](https://api.worldbank.org/v2/country/all?format=json&per_page=400) |
| `wri-v1.3.0.zip` | [WRI 发布页的 v1.3.0 ZIP](https://datasets.wri.org/datasets/global-power-plant-database) |
| `ghcnd-2024.csv.gz` / `ghcnd-stations.txt` | [2024 年观测](https://www.ncei.noaa.gov/pub/data/ghcn/daily/by_year/2024.csv.gz) / [站点元数据](https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt) |
| `atlas-hs92-country-product-2.csv` / `atlas-hs92-country-country.csv` | [两位商品章](https://dataverse.harvard.edu/api/access/datafile/13685112?format=original) / [双边国家总额](https://dataverse.harvard.edu/api/access/datafile/13685107?format=original) |
| `electricity.zip` / `gdp.zip` | [用电量栅格](https://ndownloader.figshare.com/files/31456843) / [GDP 栅格](https://ndownloader.figshare.com/files/31456837) |

```bash
python3 scripts/import-v11-supplemental.py /path/to/verified-sources \
  --dataset city --dataset policy --dataset policy-documents --dataset wind --dataset solar \
  --dataset wri-plants --dataset wdi-emissions --dataset ghcn-cn-2024 --dataset atlas-trade
```

栅格可用 `--dataset rasters` 计算并入库逐年度资产信息。正式对象登记时同时传 `--raster-s3-endpoint`，由已配置的 `boto3` 凭据访问 SeaweedFS `raw` 桶。导入在整包回读并比对 SHA-256 后写入 `catalog.file_object` 与按年资产记录，直接使用同一份原始发布压缩包。栅格专题地图的 COG、瓦片和区域统计需要后续派生层。

复核正式库时，先核对现有发布目录与文件版本，然后运行导入并从只读角色和 MCP 检索目录。正式问数发布需为上述口径配置专用查询和版本审核，避免让城市年估算落入既有省级月度发电量或 GRACED 全球日帧查询。
