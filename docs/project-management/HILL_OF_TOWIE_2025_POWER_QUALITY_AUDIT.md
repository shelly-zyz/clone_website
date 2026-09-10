# Hill of Towie 2025功率质量与限电候选字段审计

> 审计日期：2026-09-10
> 审计对象：已固定并通过MD5核验的 `10.5281/zenodo.20204946` / `2025.zip`
> 结论：发现可用的“源数据降功率证据”，但仍没有足以声明电网限电的权威标签；生产预测继续锁定

## 1. 审计原则

- 只读流式扫描本地原始ZIP，不修改ZIP、不截断负功率、不把缺失值填成0。
- 10分钟源表的月界面重复行按导入主键语义处理；审计同时保留原始月度行数。
- `PowerRed`、`PowerRef`与`Curtailment*`分开解释：源数据的降功率/设定值证据不能自动升级为电网限电标签。
- 该报告是质量审计，不是训练数据发布。审计输出JSON位于Git忽略目录 `.forecast-data/hill-of-towie/curtailment-audit.json`。

## 2. 关键结果

| 检查项 | 结果 |
|---|---:|
| 机组信号月度原始行 | 1,059,716 |
| 机组信号数据库既有核验行 | 1,059,488 |
| 日汇总行 | 8,026 |
| `wtc_PowerRed_endvalue`非空行 | 1,059,656 |
| `wtc_PowerRed_endvalue=1` | 37,322 |
| `wtc_PowerRed_timeon>0` | 66,249 |
| `endvalue=1`或`timeon>0` | 66,260 |
| 降功率证据同时对应正的实际功率 | 62,357 |
| 降功率证据同时对应零/缺失实际功率 | 3,903 |
| `wtc_PowerRef_endvalue`低于2,300 kW额定值 | 77,724 |
| 场站负功率观测 | 10,302 / 52,561（19.6%） |

### 日汇总字段

2025年的 `tblDailySummary` 中，`CurtailmentEnergy`、`CurtailmentEnergyTot`、`CurtailmentExternalEnergy`、`CurtailmentOverFreqEnergy`、`CurtailmentOverWindEnergy`和`CurtailmentTurbineEnergy`均为空；对应的小时字段也没有非零值。`EnergyLossExternalLimit`、`EnergyLossPUpperReferenceLimiter`、`EnergyLossManualControl`、`EnergyLossParkStop`和`ForgoneEnergy`虽然各有7,649个数值行，但全部为0。

因此这些日粒度字段不能提供2025年可用于小时训练的限电标签。

### 10分钟降功率与设定值

- `tblSCTurDigiIn.wtc_PowerRed_endvalue`只出现0/1，且`wtc_PowerRed_timeon`给出了该输入在10分钟窗口内的持续秒数。这是可保留的源数据降功率证据。
- `tblSCTurbine.wtc_PowerRef_endvalue`是0—2,300 kW的功率参考值；低于额定值的记录不能单独判为电网限电，因为可能来自停机、控制策略、设备状态或其他降额原因。
- 在`PowerRed`的持续/末值证据中，39,194条同时有低于额定的`PowerRef`，但27,066条仍处于额定`PowerRef`；两者不是一一对应关系。
- `wtc_CurTime_endvalue`是时间戳样式字段，不作为限电持续时间使用。

## 3. 负功率处理

场站 `ActivePowerMean` 的有效值范围为约 `-0.460528` 至 `47.970299 MW`。10,302条负值中，原始 `WPSStatus` 均为0、`DataOk`均为空；同一时刻机组功率还有部分为正、部分为零或缺失。没有源方口径允许把这些值静默截断为0，因此当前规则是：

1. 原始值保留在源表和归档中；
2. 派生场站质量码为 `suspect`；
3. 含负值的完整小时窗口不进入当前训练配对；
4. 不用插值或裁剪掩盖75.4%的配对完整率。

## 4. 语义判断与外部证据

官方数据字典明确将 `wtc_PowerRef_endvalue` 定义为有功功率设定值，并将快速日志中的 `Wtc_TDI_PowerRed_PowerRed` 定义为0/1的降功率指示；但该字典同时说明它不是穷尽的所有归档列，当前固定的v2.0描述文件也没有给出10分钟 `PowerRed` 到“电网限电原因”的完整映射。因此本项目将10分钟字段命名为“源数据降功率证据”，不命名为“已确认电网限电”。

RES官方分析仓库仍有“find simple way to filter out grid curtailment”公开问题，说明从该类SCADA数据区分电网限电本身仍是待解决的分析问题：[官方问题列表](https://github.com/resgroup/hill-of-towie-open-source-analysis/issues)。字段定义参考最新官方数据包的数据字典：[Hill of Towie data dictionary](https://zenodo.org/records/22662930/files/Hill_of_Towie_data_dictionary.md?download=1)。本项目固定使用的年度包仍是：[Zenodo v2年度源](https://zenodo.org/records/20204946)。

## 5. 已采取的安全变更

为保留证据而不污染语义，SCADA机组信号表增加了四个可空字段：

- `power_reference_kw` ← `wtc_PowerRef_endvalue`
- `power_reduced_flag` ← `wtc_PowerRed_endvalue`
- `power_reduced_seconds` ← `wtc_PowerRed_timeon`
- `power_reduced_count` ← `wtc_PowerRed_counts`

这四列与`curtailment_flag`严格分离；`curtailment_flag`和配对表的`curtailment_known`仍保持未知。服务器恢复后已按500行小批次、按月提交完成幂等回填，并在数据库端核验得到：`power_reduced_flag=true`为37,299行、`power_reduced_seconds`非空为66,219行、持续时间合计22,360,804秒；`claimed_curtailment_rows`仍为0。

## 5.1 清洁窗口画像

对已排除负/无效发电标签的6,605条小时配对做连续性和90天滑动窗口分析，结果如下：

| 检查项 | 结果 |
|---|---:|
| 唯一合格小时 | 6,605 |
| 连续区间数 | 350 |
| 最长连续区间 | 252小时（2025-02-13 19:00至2025-02-24 06:00 UTC） |
| 最佳90天窗口 | 1,854 / 2,160小时 |
| 最佳90天完整率 | 85.83% |
| 达到95%门槛的90天窗口 | 0 |

可复跑命令：

```powershell
npm run forecast:profile:clean-windows
```

因此不能通过简单删除坏点声称已有90天合格训练窗口；当前数据适合隔离后的历史回测和质量研究，不能满足正式预测的覆盖门禁。

## 6. 当前门禁结论

- 小时配对：6,605 / 8,760，完整率75.4%，低于95%门禁。
- 限电标签：`unknown-no-authoritative-grid-label`。
- 生产预测：锁定。
- 研究回测：可以使用已核验的6,605条配对，但必须保留质量和来源说明。
- 数据库动作已完成：不需要重新下载1.6GB源文件，也不需要重建6,605条NWP配对。下一步应针对2,155个负/无效小时窗口做源质量处置，并继续寻找能把源降功率证据映射到电网限电原因的权威标签；在此之前生产预测保持锁定。
