# V11 可视化与分析预测 Agent

这两个入口建立在数据库 Agent 已保存的 `DataRef` 之上，不绕过项目授权，也不让模型直接执行 SQL。

## 边界与分工

| 能力 | 设计 | 原因 |
| --- | --- | --- |
| 可视化 | **小云选图，模板服务生成配置** | 根据结果类型和用户目标选择图形，已有图表按原始结果引用重绘。 |
| 分析预测 | **小云选操作和参数，Worker 异步计算** | 入队前检查口径、连续样本与留出窗口，Worker 在锁定的数据快照上执行。 |

小云运行一个有预算的 Pi 工具循环，复用数据库 Agent 的模型配置。只有自然语言查询进入数据库子 Agent。查询成功后，小云获得已保存的结果引用和数据摘要，再调用结构化图表或分析服务。已有独立 `ask` 和 MCP 入口继续复用同一业务服务。

## 小云工具与会话

| 工具 | 输入与约束 |
| --- | --- |
| `load_skill` | 按名称加载 [预测与回测技能](../src/lib/xiaoyun/skills/forecast-review/SKILL.md)。常规查数、绘图和查看任务状态直接用相应工具。 |
| `query_data` | 查数要求和可选基准。数据库 Agent 负责语义目录、指标口径与版本。成功返回已保存的 DataRef、质量和可用能力。 |
| `inspect_data` | 读取本轮查询、之前的数据、原图或上次分析的输入。传入 `plan` 时用提交服务同一套规则预检，并返回实际留出上限等原因，无需入队。 |
| `render_chart` | 复用单指标折线或柱状模板。修改旧图使用原输入和未改的渲染设置。GFS 图按有效时间展示并标注起报。 |
| `submit_analysis`、`get_analysis` | 提交或查询项目内任务。GFS 预报帧可做描述统计。预测与回测使用连续的日度或月度历史；回测留出后至少保留 8 期训练数据。 |
| `get_sources` | 按所引用的数据、图表或分析输入追溯数据版本与来源。 |

小云每轮锁定一个专题。数据库澄清保存在问数会话的对应修订上，用户补充条件后可继续原任务。图表卡可选中追问，服务端从可视化会话验证图表及其输入引用。分析入队绑定输入快照，已有项目内相同请求 ID 重试时复用原任务。

部署时依次应用数据会话和业务会话迁移，再用 `green_ddl` 执行 [小云会话迁移](../scripts/v11-xiaoyun-context.sql)。应用角色只读写所需的澄清列。若部署只启用了部分预测模型，可在应用环境用 `OGW_ANALYSIS_ENABLED_MODELS` 登记，例如 `statsforecast,timesfm`。Worker 仍负责检查其 Python 依赖、权重和设备。

## 可视化

### 项目 MCP 工具

`/api/mcp/visualization` 提供：

- `render_echarts`：通过本地 `mcp-echarts` 生成折线/柱状图配置。
- `render_vchart`：生成官方 `@visactor/vchart` 配置。
- `render_antv`：生成官方 `@antv/g2` 配置。
- `build_power_globe_scene`：返回 MapLibre Globe 矢量瓦片层或 Three.js 设施点位场景。

`/api/visualization` 也支持直接、无 LLM 的 `render`，以及可保存上下文的 `ask_session`。模板只允许 `line`、`bar`、`echarts`、`vchart`、`antv` 这些枚举值；每次都回填 `DataRef`、字段映射和模板版本。

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
