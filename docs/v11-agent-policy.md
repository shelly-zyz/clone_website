# OpenGridWorks Agent 业务规则与预测验收

Pi 提供工具调用循环。小云和数据库子 Agent 使用独立的 Pi 实例，在一次请求内共享运行编号和调用预算。图表、分析入队和状态读取由受控服务执行，MCP 接入同一服务。模型可以提议动作和参数，服务端验证并决定能否执行。

## 权限与资源

| 身份 | 允许动作 | 权限边界 |
| --- | --- | --- |
| 小云 | 查询、检查数据、渲染、提交/读取分析、看来源 | 一个请求绑定一个专题和其项目；只引用服务端解析出的数据、图表或分析 |
| 数据库子 Agent | 查发布目录、执行固定查询模板、请求澄清 | `green_agent_ro` 只读事务和 4 秒 SQL 超时；不接受模型提供的 SQL |
| 图表和分析服务 | 读已授权结果、保存图表、提交分析 | 项目密钥及项目归属校验，`green_agent_context` 按会话修订号写入 |
| 分析 Worker | 声明可运行能力、领取匹配任务、提交任务结果 | 独立连接经 `green_agent_ingest` 进入现有 Worker 权限；按租约写回 |
| 数据审核 | 批准或驳回待审核批次 | 专用审核令牌与 `green_agent_review`；Pi 工具目录不包含审批 |

HTTP 和 MCP 使用同一来源及服务凭据校验。已发布目录和固定查询可以凭服务授权访问；项目会话、产物和任务另需该项目凭据。生产入口需要部署侧认证，现有项目密钥按持有者授权，未引入账户级成员体系。

每次请求最多 14 次工具调用、11 次模型调用。小云最多 9 次工具、7 次模型调用和 55 秒；数据库最多 5 次工具、4 次模型调用、3 次查询尝试和 25 秒，子调用不能延长父请求时间。独立的图表与分析选择器各最多一次模型及工具调用。并发上限按应用实例执行；分析入队用 PostgreSQL 事务锁串行确认容量，上限 32 个排队或运行任务。Worker 的租约为 190 秒、最多领取两次。有 Worker 在线时，超过 15 分钟仍无对应可用能力的滞留任务会被标记失败。

## 结果与审计

- 查询返回 `result_id`、`DataRef`、版本、口径、单位、覆盖和质量。单指标趋势使用时间轴；同月省级比较返回类别轴，只使用该版本同指标、同产品的省级数据，不包含全国汇总。图表与预测共享结果引用，按权限重新读取。
- 小云区分最近查询、用户选中的旧图、已有分析和待续办分析。预检失败可在 30 分钟内继续，绑定原查询结果和数据会话修订号；新查询会使旧待办失效。对已有项目、相同请求编号的重试，查询按会话收据、图表按最近的保存记录、分析按任务 ID 复用。首次请求若尚未拿到项目凭据、图表记录已滚出历史或会话被其他请求推进，不能保证按原请求重放。
- 预测输出包含数据版本、模型身份、预测粒度、训练范围和点值；回测含实际值、MAE、RMSE，具备分位数的模型返回 P10/P50/P90。Worker 写回前使用与结果卡共用的结果结构校验。
- 结构化日志统一为 `ogw.agent.audit.v1`。字段包括运行编号、子跨度、动作、结果、耗时、允许的产物引用和模型 token 用量。拒绝、工具预算耗尽和执行错误写到应用日志；查询保存、图表保存、任务入队/领取/写回、审核决定与业务变更在同一事务中追加到 `projects.agent_audit_event`。应用和 Worker 角色只能追加审计表，不得读、改或删。日志不放提示词、数据行、项目密钥、连接串或原始异常；生产日志留存及访问由部署管理员统一配置。

## 预测模型选择

| 用户需求 | 业务规则 |
| --- | --- |
| 看 GFS 已发布天气预报 | 展示真实预报帧和起报/有效时间；不作为历史观测送入模型 |
| 短期预测，未指定模型 | StatsForecast：默认 Naive；日度至少 14 个连续点、月度至少 24 个连续点后使用 SeasonalNaive |
| 比较统计模型，或要求先选再预测 | 在同一个连续序列上，用三个不重叠的滚动验证窗口比较 SeasonalNaive、AutoETS、AutoARIMA。初始训练至少 24 期；按 MAE 选，RMSE 作为同分比较依据。MAE 改善超过 5% 才升级，否则保留基线。用于预测时按获选方法用全样本重新拟合 |
| 明确指定 TimesFM 或 Chronos-2 | 模型配置与 Worker 的离线探测都通过后才允许入队。仅接入单变量与分位数输出；外生变量、多变量能力需要单独的数据契约和项目回测 |
| 没有可用历史、粒度不符、数据有断档 | 说明原因并请求补齐，不自动插值或把类别数据改作序列 |

这些是主流方法的可执行基线与候选。8 期是简单预测的最低执行门槛，不代表精度达标。月度发电要核对缺月和合并统计期，碳排日度要验证季节与异常时段。省级或城市气象历史、风光功率的气象外生变量、空间和区域层级预测均需先补数据再验收。真实业务上线门槛应按指标、地区、粒度和预测期预先约定，并另留从未用于选模的时间段；同时记录 MAE/RMSE、运行时间及失败率，有区间时再验覆盖率。

参考：[Nixtla 模型](https://nixtlaverse.nixtla.io/statsforecast/src/core/models.html)、[时间序列交叉验证](https://otexts.com/fpp3/toolbox.html)、[TimesFM](https://github.com/google-research/timesfm)、[Chronos-2](https://github.com/amazon-science/chronos-forecasting)。

### 已验证的预测样本

使用 StatsForecast 2.0.3 在 CPU 上运行预测和回测。固定月度样例覆盖「选模后用全样本拟合并预测」。对项目本机 GRACED Power 的 2025 年 8 月 31 个日帧，按项目同一口径聚合为 kgC/h。三个两日验证窗口的 MAE 为：季节基线 27,646,124，AutoETS 14,667,086，AutoARIMA 13,460,848。只用前 30 天选模、把最后一天留作独立检验，AutoARIMA 的绝对误差为 8,446,307，季节基线为 25,653,879。该样本支持保留 AutoARIMA 候选；一个月数据和一个独立检验点不能证明跨季节或其他指标上的精度。测试机首次编译约 70 秒，后续这一规模的选模约 1–2 秒，部署仍应量实际 Worker 的冷启动和延迟。

## 部署与验证顺序

1. 管理员先执行 [v11-agent-policy.sql](../scripts/v11-agent-policy.sql)，依赖现有的数据库、业务 Agent 及小云上下文迁移。再更新应用与 Worker，避免新版读到旧表结构。应用角色不需要 DDL。
2. 使用 Python 3.12。CPU Worker 安装 `scripts/analysis-cpu-requirements.txt`；可选模型在独立环境安装 `scripts/analysis-requirements.txt`。可为 CPU Worker 配置持久可写的 `NUMBA_CACHE_DIR`，减少首次编译后的重复开销。应用配置 `OGW_ANALYSIS_ENABLED_MODELS`，Worker 配置 `OGW_ANALYSIS_WORKER_MODELS`。默认均仅启用 `statsforecast`；Worker 启动时验证依赖、离线固定权重和设备，再登记能力。未登记时禁止入队对应任务。普通图表默认本地 ECharts，需要时可配置 `OGW_CHART_ECHARTS_MCP=true`。
3. 先跑 `npm run check` 和 `node --test scripts/verify-v11-xiaoyun.mjs`。可在临时目录安装 PGlite，再把 `OGW_TEST_PGLITE_ENTRY` 指向其 `dist/index.js`，运行 `node --test scripts/verify-v11-agent-policy-pg.mjs`；同时设置 `OGW_TEST_ANALYSIS_PYTHON` 可验证真实 Worker 按能力领任务。真实 StatsForecast 用 `python scripts/verify-v11-forecast-worker.py` 验证，附 `--graced <本地 NetCDF>` 可用相同清洗口径重放碳排日度数据。
4. 目标环境用真实 Pi 模型、PG 和 Worker 联测查数、出图、入队、结果与拒绝权限。在同一 `run_id` 下核对调用顺序、队列等待和计算时间，再扩大模型和数据覆盖。
