# PostgreSQL失联后的本地数据备份与迁移核验

> 核验日期：2026-09-01  
> 核验范围：项目仓库、同级`data/`、`.weather-cache/`、`.scratch/`及常见数据库备份格式  
> 本轮性质：只读盘点；未连接或修改数据库，未删除文件，未执行Git提交

## 一、结论

- **没有发现可直接整体恢复的PostgreSQL备份**：没有完整`.dump`、`.backup`、`.bak`、压缩SQL、Docker PostgreSQL数据卷或可用的本地PostgreSQL服务。
- **数据库结构仍在**：`scripts/database-schema.sql`包含17张表的建表结构。
- **零散SQL不是全库备份**：`carbon-psql-direct-last.sql`约75KB，只含1条碳源档案和1帧碳数据。
- **多数地图与能源源文件仍在本地**，可以重新导入；GRACED Power拥有最完整的“源压缩包—NetCDF—逐日帧—清单”证据链。
- **历史气候数据库不能靠现有本地文件完整恢复**：历史记录中的20个气候NetCDF和73,050个数据库日帧没有在当前磁盘找到源NetCDF；必须重新下载后重建。现有5.84GB的VRE MAT是另一套风光容量因子情景资产，不能替代这20个NetCDF。

完整的33项逐项清单、PG表恢复映射、下载入口和校验记录见：

`../outputs/20260901-data-migration-audit/能源平台数据备份与迁移清单_2026-09-01.xlsx`

## 二、已完整备份或可从本地重建

| 数据 | 本地证据 | 恢复判断 |
|---|---|---|
| GRACED Power | 2019-01—2026-04共88个月；88个源压缩包、88个NetCDF、2,677个逐日帧及88份清单；日期连续，文件缺失和大小不符均为0 | 可重建Power碳表；另有2026-05的31帧暂存在scratch，需先独立校验再合并 |
| GFDL-ESM4 SSP1-2.6 VRE | `data/VRE_gfdl-esm4_ssp126_2021_2060.mat`，5.84GB；2021—2060逐小时 | 可重建`climate_vre_hourly`及派生JSON；它是模型情景，不是实测发电 |
| GISPO VRE潜力 | 4个源CSV，共773,653行，约35MB，已留SHA-256 | 可重新聚合并导入潜力表 |
| 发电设施源档案 | WRI v1.3.0、GEM 2026-02、China Hydropower Station Dataset、GloHydroRes | 可重建中国设施地图；GEM本地文件是旧快照，应保留后再补下载新版 |
| 光伏足迹 | CPVPD-2024、ChinaPV 2015/2020压缩包 | 可重建光伏足迹图层 |
| OSM中国电力设施 | `china-260517.osm.pbf`，约1.52GB | 可重建线路、变电站、电厂和发电机图层；是2026-05-17快照 |
| 前端派生数据 | `public/data/osm-power/`、`public/data/climate-vre/`、自然地理边界、`china-map-data.generated.json` | 可暂时恢复页面，但派生文件不能替代原始源档案和数据库备份 |
| GFS天气 | `.weather-cache/`共13项指标 | 只可恢复2026-07-26的一次真实预报快照；已过期，迁移后需刷新 |
| 补充材料 | Aqueduct沿海洪水栅格、2024全国电力可靠性报告 | 本地文件可直接迁移 |

## 三、只有部分备份

| 数据 | 当前本地内容 | 缺口 |
|---|---|---|
| GRACED total | 仅发现2019-02和2021-03两个月scratch | 其余月份需重新下载 |
| GRACED InternationalAviation | 仅发现2024-06一个月scratch | 其余月份需重新下载 |
| PeeringDB设施 | 只保留24条中国设施的派生结果和审核表 | 原始API响应未保存，建议重新抓取并保存原始JSON |
| 官方统计 | 代码/页面中有部分全国口径和报告 | 缺机器可读的、可版本化的完整原始表，特别是省级数据 |
| GFS | 只有单次预报缓存 | 不构成历史NWP档案，不能支持预测训练 |

## 四、没有本地备份，需要重新下载或另行取得

| 数据 | 结论 | 推荐入口 |
|---|---|---|
| 20个历史气候NetCDF | 当前磁盘未找到；历史数据库日帧无法直接迁移 | `https://zenodo.org/records/20501729` |
| GRACED Industry、GroundTransportation、Residential、Shipping及缺失的total/航空月份 | 未发现完整源文件 | `https://carbonmonitor-graced.com/` |
| ERA5历史气象 | 未下载，需要用户CDS账号和Token | `https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels` |
| WFDE5 | 未下载 | `https://doi.org/10.24381/cds.20d54e34` |
| ISIMIP3b | 未下载；属于后期情景扩展 | `https://data.isimip.org/` |
| 省级小时负荷与真实风光出力 | 未发现 | 需从电网、交易中心、场站或授权数据源取得 |
| 省间通道容量/损耗/成本/潮流 | 未发现 | 需从电网规划、交易披露或授权数据取得 |
| 储能参数与SOC | 未发现 | 需从项目业主、调度机构或授权数据取得 |
| 分省分电源排放因子 | 未发现 | 需先确定权威口径，再下载或计算 |

## 五、建议的数据迁移顺序

1. **先只复制，不整理或删除**：把`data/`、`.weather-cache/`、`public/data/`、数据库脚本和本清单复制到新盘，并保留原目录结构。
2. **优先保护不可替代或体积最大的资产**：GRACED Power、VRE MAT、OSM PBF、所有源ZIP和GISPO CSV。
3. **复制后做校验**：对大文件核对大小与SHA-256；对GRACED逐月核对manifest、日期连续性和文件数。
4. **建立新的PostgreSQL/PostGIS**：先执行结构脚本，再按“源文件→标准化表→派生表”的顺序导入。
5. **重新下载明确缺失的数据**：先补20个气候NetCDF和缺失GRACED部门，再处理ERA5等需要账号的数据。
6. **最后更新页面接口**：恢复表行数、时间范围和缺失率后，才把对应模块标记为“可用”。

## 六、迁移前仍需用户提供的信息

- 新数据要复制到哪个磁盘或目录；
- 是只做文件级安全副本，还是同时建立本地PostgreSQL/PostGIS；
- 需要账号/Token/验证码的数据源，是否由用户登录后再由Codex继续。

在目标目录尚未明确前，本轮没有移动或下载大型数据，避免重复占用数十GB空间。
