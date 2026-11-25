# 四专题补充数据入库与语义目录

本轮按气象、电力、碳、经济核对用户提供的七组来源。覆盖基线来自项目代码及既有验收记录。正式 `zyz` 无法连接期间，实际基线和正式入库状态需要在服务器复核。Beads 追踪 `ogw-22p.9.91`。

## 来源与缺口

| 来源 | 专题与用途 | 核验结果及接入位置 |
| --- | --- | --- |
| `D:\10.19数据集\carbon databases` | 碳。先按文件确认排放、碳价、因子或栅格等实际产品，检查与既有 GRACED 和 OECD 碳贸易重叠 | 只有服务器路径，待通过 `/mnt/d/10.19数据集/carbon databases` 或 Windows 侧确认。先采集相对路径、大小、哈希、格式、版本及授权，再提取气体、部门、口径、单位、时空粒度。现有碳产品仍沿用各自的事实表。 |
| [中国能源转型政策 v1](https://doi.org/10.6084/m9.figshare.32182515.v1) | 电力、碳及经济的政策研究 | 国家、省级、地级三个层级共有 1,736 个地区年度、36 个标签和小计字段，整理为 62,496 条分类计数。年份按生效日，地方表含 2025 年记录。多个标签可以来自同一政策，分类次数不能当作独立政策数。下载的 Stata 代码显示中央汇总段引用了部分 `local` 输入，层级比较需核实。 |
| [Global Renewables Watch v1.0](https://github.com/microsoft/global-renewables-watch/releases/tag/v1.0) | 电力。全球陆上风机和商业光伏的卫星检测及季度分布 | 两个 GeoPackage 与 GitHub 发布 SHA-256 一致。风机 375,197 条，光伏 86,345 条，其中 5 条空几何保留且有标记。README 的光伏数为 86,410。原文件几何为 EPSG:3857，使用 WKB 和 SRID，保留原发布国家标签、地类及其他字段。建设季度是推断值，2017Q4 可能包含此前已建成设施。 |
| [夜间灯光推算的 1 km 用电量及实际 GDP v1](https://doi.org/10.6084/m9.figshare.17004523.v1) | 电力的空间用电密度和经济的空间产出 | 两份 ZIP 各有 1992–2019 的 28 个年包，原压缩文件合计 6,182,719,292 字节。2019 年的两份样本通过 ZIP CRC，均为 36,080 × 15,517 的 World Mollweide 1,000 米浮点栅格，NoData 约为 −3.402823 × 10³⁸。论文报告用电单位 kWh、实际 GDP 为 2017 年不变价百万美元。正式登记到 SeaweedFS 和 V11 对象目录前，仍需逐年验证全量文件哈希、栅格头及聚合口径。 [论文](https://doi.org/10.1038/s41597-022-01322-5) |
| [中国城市发电及电力部门 CO₂ 估算 v1](https://doi.org/10.6084/m9.figshare.30338773.v1) | 电力与碳共用一张城市年度事实表 | 352 个城市 × 20 年，7,040 条。保留源六位行政区划代码、英文城市名、工作簿行号和原单位。发电量为亿千瓦时，排放量为万吨 CO₂。研究用 PSO-BP 估算城市发电量，以 2021 年省级电力排放因子计算 2000–2019 年排放。 [论文](https://doi.org/10.1038/s41597-026-07484-w) · [计算代码](https://doi.org/10.6084/m9.figshare.30338803) |
| [Awesome Public Datasets](https://github.com/awesomedata/awesome-public-datasets) | 多专题来源索引 | 电力的全球电厂库可补电厂坐标和容量，先与 OSM 资产核对。经济地球已用 World Bank WDI 的 GDP、人均 GDP、出口额，其他序列按指标代码检查。气象可对照 NOAA 地面站日观测与 Copernicus 再分析。碳相关条目先与服务器原始目录去重。 [WRI 全球电厂库](https://datasets.wri.org/datasets/global-power-plant-database) · [NOAA GHCN-Daily](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc%3AC00861) · [Copernicus 气候数据](https://cds.climate.copernicus.eu/datasets) |
| [Global Weather Data](https://global-weather-data.com/) | 气象。城市历史天气、城市预报、格点预报 | 网站公开提供产品介绍并显示下载额度及分档，匿名打开城市历史下载入口会显示账户登录。取得样本后需核验底层来源及版本、时区、变量和入库使用条件。城市历史观测或再分析可补 GFS/WRF/ClimaX 预报和既有回放的时间维度。 |

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

```bash
python3 scripts/import-v11-supplemental.py /path/to/verified-sources \
  --dataset city --dataset policy --dataset wind --dataset solar
```

复核正式库时，先核对现有发布目录与文件版本，然后运行导入并从只读角色和 MCP 检索目录。正式问数发布需为上述口径配置专用查询和版本审核，避免让城市年估算落入既有省级月度发电量或 GRACED 全球日帧查询。
