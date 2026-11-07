# V11 可视化与分析预测 Agent

这两个入口建立在数据库 Agent 已保存的 `DataRef` 之上，不绕过项目授权，也不让模型直接执行 SQL。

## 边界与分工

| 能力 | 设计 | 原因 |
| --- | --- | --- |
| 可视化 | **工具优先，Pi 仅做选图与会话追问** | 已知数据与模板时，图表配置应可复现、可校验；不需要让 LLM 自主生成图表代码。 |
| 分析预测 | **Pi Agent + 异步 Worker** | 需要根据意图选择描述、聚类、预测、回测或比较，并处理耗时模型、任务状态与追问。 |

Pi 两个入口复用数据库 Agent 的 `getPiModel()` 配置（`DATA_AGENT_PI_*`、`DEEPSEEK_API_KEY`）。模型只能调用一个严格的选择工具；选择值再由 Zod schema 解析。工具异常、超时或无效输出不会重试模型调用。

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

## 验证记录

`scripts/verify-v11-business-agents.mjs` 覆盖真实的项目 DataRef、MCP 调用、会话 revision、项目隔离、描述/聚类、StatsForecast 回测、TimesFM 与 Chronos-2 比较。浏览器验证确认 ECharts、VChart、AntV G2、MapLibre Globe 与 Three.js 均可渲染。

主要上游实现： [Apache ECharts](https://github.com/apache/echarts)、[AntV G2](https://github.com/antvis/G2)、[VChart](https://github.com/VisActor/VChart)、[TimesFM](https://github.com/google-research/timesfm)、[Chronos](https://github.com/amazon-science/chronos-forecasting)、[StatsForecast](https://github.com/Nixtla/statsforecast)。
