# V11 小云业务说明

共用权限、调用预算、审计、模型选择与上线检查见 [Agent 业务规则与预测验收](v11-agent-policy.md)。

小云运行一个有预算的 Pi 工具循环。数据库 Agent 负责自然语言查数和查询口径，小云根据查询回执组织后续动作。图表与分析服务通过授权的结果引用读取数据，知识答复与数据来源有各自的边界。

## 边界与分工

| 板块 | 执行职责 | 当前支持范围 |
| --- | --- | --- |
| 查数与口径 | **数据库 Agent 查目录、校验条件并查询** | 气象、电力、碳三个发布专题。成功结果包含 `result_id`、`DataRef`、实际条件及质量。数据库需要澄清时，保存待续请求。详见 [共用数据库 Agent](./v11-data-agent.md)。 |
| 可视化 | **小云选图，模板服务生成配置** | 按数据形状和用户目标选择单指标折线或柱状。ECharts、VChart 和 AntV 是渲染器选项。重绘旧图时沿用图表引用的数据和未修改的设置。OSM 电力点场景有独立入口。 |
| 统计与聚类 | **小云选操作，分析服务校验，Worker 执行** | 描述统计与单变量数值聚类。输入为已保存的数据结果，任务卡提供状态和计算结果。 |
| 预测与回测 | **小云按需读技能、预检和提交，Worker 异步计算** | 区分已发布预报与历史外推。回测根据连续期数和留出窗口确定可行方案，任务锁定数据快照及模型参数。 |
| 通用问答与来源 | **小云组织解释，工具提供站点目录与数据来源** | `list_available_datasets` 核对已发布指标的口径与范围，`get_sources` 沿数据、图表或分析引用追溯。带 `EvidenceRef` 的知识库检索是后续能力。 |
| 数据治理 | **定时接入、发布服务和审核人员负责** | 新批次检查、人工复核及发布走独立角色。小云的问数工具只读已发布数据。 |

### 核心说明、技能和校验

小云的常驻说明覆盖专题选择、引用解析、澄清续接、常规选图和工具调用。预测与回测是首个独立技能，集中说明同一句「未来三天」怎样区分查看已有预报与执行新的预测，以及样本不足时如何向用户提供选择。其他板块的工作方式按上表和各自工具契约维护。项目授权、模板参数、数据版本、模型启用状态和预测预检由服务执行。

## 小云工具与会话

| 工具 | 输入与约束 |
| --- | --- |
| `load_skill` | 按名称加载 [预测与回测技能](../src/lib/xiaoyun/skills/forecast-review/SKILL.md)。常规查数、绘图和查看任务状态直接用相应工具。 |
| `query_data` | 查数要求和可选基准。数据库 Agent 负责语义目录、指标口径与版本。成功返回已保存的 DataRef、质量和可用能力。 |
| `inspect_data` | 读取本轮查询、之前的数据、原图或上次分析的输入。传入 `plan` 时用提交服务同一套规则预检，并返回实际留出上限等原因，无需入队。 |
| `render_chart` | 复用单指标折线或柱状模板。修改旧图使用原输入和未改的渲染设置。GFS 图按有效时间展示并标注起报。 |
| `submit_analysis`、`get_analysis` | 提交或查询项目内任务。GFS 预报帧可做描述统计。预测与回测使用连续的日度或月度历史；回测留出后至少保留 8 期训练数据。 |
| `get_sources` | 按所引用的数据、图表或分析输入追溯数据版本与来源。 |
| `list_available_datasets`、`utc_now` | 查看已发布数据的名称、指标单位、口径或当前 UTC 时间。 |

小云每轮锁定一个专题。数据库澄清保存在问数会话的对应修订上，用户补充条件后可继续原任务。图表卡可选中追问，服务端从可视化会话验证图表及其输入引用。分析入队绑定输入快照，已有项目内相同请求 ID 重试时复用原任务。

### 跨板块交接

1. **查数并出图或分析。** 小云将地区、时段和指标等取数要求交给数据库 Agent。成功后，出图和分析共同引用本轮 `result_id`。查询为空、全缺测或尚待澄清时，依赖该查询的动作暂停。
2. **追问已有结果。** 修改样式时用原图的 `result_id`。修改地区或时段时，以被引用的结果作为数据库查询基准。查询基准默认固定版本，用户明确要求更新时才取最新发布版。
3. **从任务状态回到来源。** 查看预测进度用任务引用，修改模型或期数以原任务的数据与参数为基准。查来源时沿对应引用读数据版本和来源，当前专题的最新查询只用于用户指向该查询时。

部署时依次应用数据会话和业务会话迁移，再用 `green_ddl` 执行 [小云会话迁移](../scripts/v11-xiaoyun-context.sql)。应用角色只读写所需的澄清列。若部署只启用了部分预测模型，可在应用环境用 `OGW_ANALYSIS_ENABLED_MODELS` 登记，例如 `statsforecast,timesfm`。Worker 仍负责检查其 Python 依赖、权重和设备。

## 可视化

### 项目 MCP 工具

`/api/mcp/visualization` 提供：

- `render_echarts`：通过本地 `mcp-echarts` 生成折线/柱状图配置。
- `render_vchart`：生成官方 `@visactor/vchart` 配置。
- `render_antv`：生成官方 `@antv/g2` 配置。
- `build_power_globe_scene`：返回 MapLibre Globe 矢量瓦片层或 Three.js 设施点位场景。

`/api/visualization` 支持直接调用的 `render`、保存结构化配置的 `render_session`，以及兼容的自然语言 `ask_session`。图形模板支持 `line` 和 `bar`，渲染器支持 `echarts`、`vchart` 和 `antv`。每次都回填 `DataRef`、字段映射和模板版本。多地区排名、通用网格图和预测产物图需要各自的数据契约与模板。

没有直接使用社区 VChart / AntV 外部 MCP 服务：它们的默认实现会把图表请求发送到远程图片服务。这里用官方前端包和本项目 MCP 路由生成本地配置，避免把项目数据交给第三方服务。前端调用时按 `renderer` 装配对应运行时即可。

## 分析预测

`/api/mcp/analysis` 与 `/api/analysis` 提供：

- `describe_series`：均值、中位数、最小/最大值、标准差；
- `cluster_series`：KMeans 单变量聚类；
- `run_forecast`：预测；
- `run_backtest`：留出回测；
- `compare_models`：统计基线与指定模型的比较；
- 会话与任务状态读取。

Worker 使用固定、可追溯版本：StatsForecast `2.0.3`、TimesFM `3.0.2`（权重 revision `1d952420fba87f3c6dee4f240de0f1a0fbc790e3`）和 Chronos `2.2.2`（权重 revision `29ec3766d36d6f73f0696f85560a422f50e8498c`）。Worker 的输入是已保存结果中的值、时间粒度和 DataRef 快照，不重新访问业务表。

启动 Worker：

```bash
python3 -m venv /opt/opengridworks-analysis/venv
/opt/opengridworks-analysis/venv/bin/pip install -r scripts/analysis-requirements.txt
DATA_AGENT_INGEST_DATABASE_URL=postgresql://worker:password@host:5432/zyz \
OGW_ANALYSIS_PYTHON=/opt/opengridworks-analysis/venv/bin/python \
OGW_ANALYSIS_DEVICE=cuda npm run analysis:worker
```

应用服务通过 `green_agent_context` 写入，Worker 通过 `green_agent_ingest` 从 PostgreSQL 的 `results.analysis_job` 抢占任务。任务有 190 秒租约、最多两次尝试、队列上限 32；超时或 Worker 异常会明确标记失败，不会驱动 Pi 反复消耗 token。

## 上下文与权限

每个项目可创建多个独立的可视化/分析会话。会话保存数据结果引用、最后确认的图表/分析参数，以及最近四轮精简交互；更新使用 `revision` 乐观锁，避免并发追问互相覆盖。

会话持久化在 PostgreSQL `projects.agent_session`，异步任务持久化在 `results.analysis_job`。两张表都以 `projects.data_project` 外键约束项目归属；项目存在性、DataRef 读取和写入仍经过数据库 Agent 的访问散列校验。迁移由 `green_ddl` 执行 [`v11-business-agent-context.sql`](../scripts/v11-business-agent-context.sql)，网站运行角色不需要也不应拥有 DDL 权限。

## 验证

`node --test scripts/verify-v11-xiaoyun.mjs` 使用实际的 Pi 循环、图表配置和分析预检代码，替换模型和 PostgreSQL 边界。用例覆盖技能加载、同轮查数出图和入队、旧图输入绑定、GFS 展示、预测预检、澄清恢复及空结果。

配置 `DEEPSEEK_API_KEY` 后运行 `node scripts/verify-v11-xiaoyun.mjs --live`，用同一模型和固定数据对照技能版与提交 `a4b5b8e`。输出记录已有 GFS 预报、历史风速外推和十期月度数据回测三期的工具路径。对照只替换模型响应，数据和队列仍使用固定样例。

`scripts/verify-v11-business-agents.mjs` 覆盖真实的项目 DataRef、MCP 调用、会话 revision、项目隔离、描述/聚类、StatsForecast 回测、TimesFM 与 Chronos-2 比较。浏览器验证确认 ECharts、VChart、AntV G2、MapLibre Globe 与 Three.js 均可渲染。

主要上游实现： [Apache ECharts](https://github.com/apache/echarts)、[AntV G2](https://github.com/antvis/G2)、[VChart](https://github.com/VisActor/VChart)、[TimesFM](https://github.com/google-research/timesfm)、[Chronos](https://github.com/amazon-science/chronos-forecasting)、[StatsForecast](https://github.com/Nixtla/statsforecast)。
