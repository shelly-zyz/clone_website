# Hill of Towie 2025历史GFS配对报告

> 生成日期：2026-09-10  
> 当前结论：本地点值和小时配对已写入服务器PG并完成独立核验；源数据质量门禁未通过，仍为研究级数据。另已发现并准备保留PowerRed/PowerRef源证据，但不把它们升级为电网限电标签。

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
| 降功率源证据 | `PowerRed`/`PowerRef`已在原始2025 ZIP中发现，含义和限电原因仍需分离 |

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

## 2.1 源功率质量与限电候选字段审计

对同一份已核验的2025 ZIP做只读流式扫描后，得到：

- `tblDailySummary`的`CurtailmentEnergy*`、`CurtailmentExternal*`、`CurtailmentOver*`和`CurtailmentTurbine*`在2025年为空；`CurtailmentHours`及多项`EnergyLoss*`虽有数值行但全部为0；
- `tblSCTurDigiIn.wtc_PowerRed_endvalue`为0/1，原始月度行中37,322条为1，`wtc_PowerRed_timeon>0`有66,249条；
- 在`PowerRed`末值或持续时间证据中，62,357条同时有正的实际功率，3,903条为零或缺失；但27,066条的`PowerRef`仍处于额定值，不能把该信号直接命名为电网限电；
- `tblSCTurbine.wtc_PowerRef_endvalue`低于2,300 kW额定值的行有77,724条；它是设定值证据，不是限电原因标签。

详细审计见`HILL_OF_TOWIE_2025_POWER_QUALITY_AUDIT.md`。SCADA表新增的四个源证据列与`curtailment_flag`分离；本次第二轮追加导入在目标PG服务主动断开后中止，待服务恢复后以较小批次重跑并完成字段计数，历史NWP配对无需重新下载。

## 3. PostgreSQL状态

首次尝试连接 `218.197.118.49:5432/zyz` 时，在执行任何SQL之前连接超时。服务器恢复后重试成功，幂等导入结果为：

```text
connection to server at "218.197.118.49", port 5432 failed: timeout expired
```

```text
forecast_nwp_sources: paired-research-only
forecast_nwp_points: 2,921
forecast_training_pairs: 6,605
future_issue_rows: 0
mismatched_valid_times: 0
duplicate_or_capacity_overflow_rows: 0
curtailment_known_rows: 0
```

既有SCADA复核仍为21台机组、52,561条场站观测和1,059,488条机组信号；配对导入没有删除或重建SCADA。当前服务器数据库端独立核验命令为：

```powershell
npm run forecast:import:nwp
npm run forecast:verify:nwp
```

导入成功也只代表研究配对落库，不会解锁生产预测；还必须解决负标签质量缺口、获得明确限电标记，并证明模型稳定胜过持久性基线。
