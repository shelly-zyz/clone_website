# Hill of Towie 2025历史GFS配对报告

> 生成日期：2026-09-10  
> 当前结论：本地点值和小时配对已完成可复核构建，但源数据质量门禁未通过；NWP表尚未写入服务器PG

## 1. 来源与范围

- 实测标签：Hill of Towie v2 2025年度SCADA，官方Zenodo记录 `10.5281/zenodo.20204946`，文件大小 `1,596,220,683` 字节，MD5已核验；SCADA已结构化导入服务器PG。
- 历史预报：NOAA GFS 0.5°业务预报 `pgrb2.0p50`，保留实际模式起报时间和有效时间，从公共 `noaa-gfs-bdp-pds` 归档按 `.idx` 和HTTP Range提取100米U/V风场。
- 时段：2025-01-01 00:00 UTC至2026-01-01 00:00 UTC；每日00/06/12/18 UTC起报，使用+003/+006小时，得到2,921个3小时点值。
- 空间：Hill of Towie质心最近的0.5°网格点，57.5°N、357.0°E；没有把全球GRIB原文件复制进PG。

NOAA官方产品页说明GFS提供0.5°全球预报、每日四次起报和3小时有效时次：[NOAA Global Forecast System](https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast)。场站原始数据和许可信息以官方Zenodo记录为准：[Hill of Towie Wind Farm Open Data v2](https://zenodo.org/records/20204946)。

## 2. 本机审计结果

| 项目 | 结果 |
|---|---:|
| GFS点值任务 | 2,921 / 2,921，失败0 |
| 唯一有效时刻 | 2,921 |
| 唯一网格点 | 1 |
| 唯一场站观测 | 52,561 |
| 完整小时候选 | 8,760 |
| 含负或无效发电标签的小时 | 2,155，已排除 |
| 保留训练配对 | 6,605 |
| 配对完整率 | 75.4%，低于95%门禁 |
| NWP缺失目标 | 0 |
| 可用容量证据小时 | 8,451 |
| NWP原生3小时 | 2,201 |
| NWP线性U/V插值 | 4,404 |
| 限电标签 | 未知，`curtailment_known=false` |

月度SCADA文件在月界面重复包含次月00:00；构建脚本按已导入PG的主键语义去重11个重复边界。负发电标签没有场站口径证据允许直接截断为0，因此保留在原始SCADA语义中、训练配对中排除，并将未来重导的派生质量码标为 `suspect`。

本机文件位于Git忽略目录：

- `.forecast-data/noaa-gfs/hill-of-towie-2025/hill-of-towie-2025-gfs-100m.ndjson`
- `.forecast-data/noaa-gfs/hill-of-towie-2025/hill-of-towie-2025-training-pairs.ndjson`
- `.forecast-data/noaa-gfs/hill-of-towie-2025/pairing-audit.json`

复核命令：

```powershell
npm run forecast:verify:gfs-local
npm run forecast:validate:pairs
```

其中 `forecast:validate:pairs` 的预期结果是结构有效但退出码为1，因为75.4%低于95%完整率门禁；这是锁定行为，不是脚本异常。

## 3. PostgreSQL状态

本轮尝试连接 `218.197.118.49:5432/zyz` 时，在执行任何SQL之前连接超时：

```text
connection to server at "218.197.118.49", port 5432 failed: timeout expired
```

因此本轮没有创建 `forecast_nwp_sources`、`forecast_nwp_points` 或 `forecast_training_pairs`，没有改写已存在的SCADA表。服务器恢复可达后，导入脚本是幂等的：

```powershell
npm run forecast:import:nwp
npm run forecast:verify:nwp
```

导入成功也只代表研究配对落库，不会解锁生产预测；还必须解决负标签质量缺口、获得明确限电标记，并证明模型稳定胜过持久性基线。
