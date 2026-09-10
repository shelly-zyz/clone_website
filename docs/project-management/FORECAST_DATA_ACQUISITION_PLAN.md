# 真实风光预测训练数据获取与门禁计划

> 建立日期：2026-09-09  
> 当前状态：获取通道与验证器已就绪；真实训练配对仍被数据缺口阻塞  
> 适用范围：风电/光伏小时基线与15分钟超短期预测

## 1. 当前结论

项目当前具备最新 GFS 正式预报，但只有少量当前批次；长期 VRE/CMIP6 是模型情景。仓库没有历史 NWP—真实功率配对，也没有授权的场站或省级风光出力时间序列。因此：

- 小时级和15分钟预测都保持锁定；
- 不能使用长期容量因子、GISPO潜力、年度统计或插值曲线代替真实功率；
- 不能使用事后再分析资料冒充预测时刻可获得的历史 NWP；
- 下一次有效推进必须先取得合法的真实功率文件及其实体、容量和质量元数据。

## 2. 最小交付包

建议先选择一个真实风电场或光伏场做试点。最低可接受范围为连续90天，推荐一年；15分钟数据优先，只有小时数据时仅进入小时基线。

每行必须包含：

| 字段 | 要求 |
|---|---|
| `entity_id` | 稳定的省级或场站标识，不使用每批变化的名称 |
| `entity_level` | `plant`或`province` |
| `technology` | `wind`或`solar` |
| `entity_latitude` / `entity_longitude` | 实体代表点坐标，用于裁剪和配对历史NWP |
| `observed_at` | 带UTC偏移的ISO 8601时间 |
| `observed_power_mw` / `observed_power_unit` | 实测功率，单位固定为`MW` |
| `nwp_issue_time` | 当时实际可见的预报起报时间；必须早于有效时间 |
| `nwp_valid_time` | 与`observed_at`表示同一时刻 |
| `nwp_wind_speed_mps` | 风电行必填 |
| `nwp_surface_solar_radiation_wm2` | 光伏行必填 |
| `installed_capacity_mw` | 正装机容量 |
| `available_capacity_mw` | 当时可用容量，不得高于装机容量 |
| `outage_flag` / `curtailment_flag` | 布尔值或0/1 |
| `timezone` | IANA时区，例如`Asia/Shanghai` |
| `quality_code` | `valid`、`suspect`、`missing`或`invalid`；后三类进入隔离 |
| `data_identity` | 功率标签必须为`observed` |
| `observation_source` / `nwp_source` | 可追溯来源名称或授权系统标识 |
| `data_license` | 明确许可或授权范围，不接受空值 |
| `resolution_minutes` | 只接受15或60 |

输入格式支持CSV、JSON、NDJSON和JSONL。模板只描述字段，不提供或生成业务样例值，避免样例被误用为训练数据。

可直接复制填写的空表头：`docs/project-management/forecast-training-template.csv`。

## 3. 解锁规则

验证命令：

```powershell
node scripts/validate-forecast-training-data.mjs "D:\authorized-data\forecast-training.csv"
```

默认门禁：

1. 所有必填字段、单位、时间偏移、来源和数据身份通过；
2. NWP起报时间严格早于有效时间，防止未来信息泄漏；
3. 实测时间与NWP有效时间为同一绝对时刻；
4. 每个实体至少连续90天，时间完整率不低于95%；
5. 至少95%的输入行为`quality_code=valid`；
6. 容量、功率、停机、限电和技术专用NWP变量通过范围检查；
7. `60`分钟仅解锁小时基线，`15`分钟才有资格进入超短期实验。

通过结构门禁不等于模型可发布。Unit 6还必须采用滚动时间切分，报告模型版本、训练窗口、生成时间、预测时效和历史误差；概率区间必须经过校准。

## 4. 获取责任与顺序

### 用户需要提供或授权

- 从场站、业主、电网公司或交易中心合法取得的真实功率文件；
- 对应实体ID、技术类型、装机/可用容量、停机、限电、时区和质量码；
- 文件许可范围，以及能否用于课程展示、模型训练和结果留存；
- 若门户需要登录、验证码、付费或协议，由用户完成登录/许可，不在聊天中发送密码或密钥。

### 助手可以继续完成

- 对用户提供的文件做只读探测、字段映射、单位和时间检查；
- 在实体位置和时间范围确定后，按中国局部范围下载对应历史GFS档案；
- 将NWP按`issue_time + valid_time`配对，生成隔离报告而不是静默填补；
- 运行门禁并输出可进入小时基线、15分钟实验或继续锁定的结论。

### 暂不执行

- 未确定实体、经纬度和时间范围前，不盲目下载全国多年GFS；
- 不使用ERA5/WFDE5替代历史业务预报做无泄漏回测；它们可用于独立气象校验；
- 不训练LightGBM、LSTM、GADF/CNN或生成P10/P50/P90。

## 5. 推荐试点

优先顺序：

1. 单一风电场，一年15分钟功率与容量/限电记录；
2. 同期历史GFS，至少包含10米/100米风、温度、湿度和气压；
3. 先做持续性和前一日同刻基线；
4. 再扩展到单一光伏场，增加短波辐射和云量；
5. 场站门禁稳定后再扩展到省级聚合。

这是最小可验证闭环，能够先证明时间对齐、泄漏控制和回测方法正确，避免一开始下载全国多年大文件却没有真实标签可配对。

## 6. 当前机器实跑结果

```text
current GFS forecast: available
historical NWP archive: unavailable
observed wind/solar power: unavailable
paired training file: unavailable
prediction unlocked: false
```

仓库自检：

```powershell
npm run validate:forecast-data
```

该命令会先运行12项门禁测试，再报告当前训练配对缺口。缺数据时返回“锁定”是正确状态，不会生成替代训练文件。

## 7. SDWPF真实SCADA旁路试点（2026-09-09）

已从百度KDD Cup 2022官方页面直接获取SDWPF公开竞赛数据，不使用第三方镜像：

- 原始文件：4,727,520行，134台风机，245天，10分钟粒度；`Patv`为有功功率；
- 来源：龙源电力真实风场SCADA，官方论文与竞赛页均可追溯；
- 原始SHA-256：`6CF7613A82C61BB5CF9FCBBF22E3F6C48165FA32021EB6F1905CB2B7AF4D7667`；
- 原始文件只保存在`.forecast-data/sdwpf/`本机忽略目录，不进入Git和前端静态资源；
- 官方下载页未声明明确的再分发许可证，因此只保存处理代码、来源信息和本地计算结果，不重新发布原始SCADA；
- 数据只有匿名日序和风机相对坐标，也不含历史NWP起报/有效时间，因此只能作为真实SCADA历史回测旁路，不能解锁生产NWP预测。

执行命令：

```powershell
.forecast-data\model-venv\Scripts\python.exe -m pip install -r scripts\requirements-sdwpf-lightgbm.txt
npm run forecast:sdwpf
```

按论文规则隔离缺测、未知停机/限电和异常方向值后，95%机组覆盖门槛留下19,171个可回测聚合时刻。全量持久性基线在D1–214训练区间、D215–245留出区间得到10分钟MAE 3.942 MW、RMSE 5.860 MW。

Unit 6模型比较采用三折扩展窗口滚动验证：D1–121/122–152/153–183、D1–152/153–183/184–214、D1–183/184–214/215–245。LightGBM 4.7.0只使用当前/历史SCADA、实测风速、覆盖率和日内时间，不使用未来气象。10分钟模型在后两折胜出、第一折失败，三折平均提升0.66%、最差一折-1.05%，未满足“每折均胜基线”的稳定准入规则；30分钟和60分钟三折均未胜基线，平均提升分别为-7.16%和-13.87%。因此所有时效均拒绝，持久性仍是当前透明基线。`/china`只展示这些历史回测结论，不生成P10/P50/P90，也始终标注“生产预测锁定”。
