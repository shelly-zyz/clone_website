# Hill of Towie 2025 PostgreSQL导入报告

> 验收时间：2026-09-10  
> 目标：`218.197.118.49` / PostgreSQL 17.5 / 数据库`zyz`  
> 状态：结构化SCADA导入完成；生产预测仍锁定

## 来源完整性

- 来源：Hill of Towie Wind Farm Open Data v2；DOI `10.5281/zenodo.20204946`；CC BY 4.0。
- 本地源文件：`2025.zip`，1,596,220,683字节。
- 官方MD5与本地复算一致：`d3cd7edb535a45ffca1c7028b397f035`。
- ZIP包含156个CSV，解压总量约7.04GB；导入前通过ZIP CRC检查。
- PostgreSQL保存预测所需结构化字段和源文件证据，不把压缩包作为单个`bytea`对象写入数据库。

## PostgreSQL落地表

- `website_data.forecast_scada_sources`：来源、许可、年度、原文件大小和MD5、导入状态及场站画像。
- `website_data.forecast_scada_turbines`：21台机组的Station ID、坐标、2.3MW额定功率、机型、轮毂高度和叶轮直径。
- `website_data.forecast_scada_observations`：场站10分钟有功功率与电量。
- `website_data.forecast_scada_turbine_signals`：机组10分钟功率、风速、运行/待机/故障秒数、故障停机证据、源数据降功率证据和质量码。

追加的源字段保持和限电语义分离：`power_reference_kw`、`power_reduced_flag`、`power_reduced_seconds`、`power_reduced_count`分别对应`wtc_PowerRef_endvalue`和`wtc_PowerRed_*`。它们用于质量审计，不自动填充`curtailment_flag`。

## 独立反查结果

| 项目 | 结果 |
|---|---:|
| 来源状态 | `imported` |
| 场站装机 | 48.3 MW |
| 场站观测 | 52,561行 |
| 机组信号 | 1,059,488行 |
| UTC覆盖 | 2025-01-01 00:00:00—2026-01-01 00:00:00 |
| 场站功率缺失 | 0 |
| 机组信号缺失质量码 | 73 |
| 场站时间重复键 | 0 |
| 机组时间重复键 | 0 |
| 非空限电声明 | 0 |

月度检查发现2025年9月只有50,506条机组信号，显著低于其他月份约9万条。按全年场站时刻计算，T02、T05、T08的时间完整率分别为94.53%、93.98%、94.17%，低于95%逐实体门槛；其他18台机组达到95%以上。这些缺口保持原样，不插值、不复制、不生成假记录。

## 仍未解锁的条件

1. 历史NWP与小时配对已入PG，但仅为研究级配对，仍缺少生产质量门禁；
2. 2,155个完整小时窗口含负或无效发电标签，当前仅保留6,605条小时配对；
3. `fault_outage_flag`只表示明确的故障秒数证据，不等于所有停机原因；
4. `PowerRed`/`PowerRef`已发现并准备以独立字段保留，但它们不是权威电网限电标签，`curtailment_flag`仍保持`NULL`；
5. T02、T05、T08需要隔离或另选连续覆盖窗口。

完整的候选字段审计见`HILL_OF_TOWIE_2025_POWER_QUALITY_AUDIT.md`。该审计还发现日汇总中的`Curtailment*`字段在2025年为空或全为0，不能用于小时训练标签。因此当前数据只能进入历史回测/小时基线研究，不能生成正式预测或P10/P50/P90。
