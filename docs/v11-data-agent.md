# V11 共用数据库 Agent

V11 第 1.5 节规定模块通过 `DataRef` 交接。第 2.4–2.7 节规定数据 Agent 读取已审核的语义目录，优先使用固定查询，再进入受控 Text-to-SQL。电源、气象和碳地球通过同一服务按专题取数。可视化、分析预测和知识 Agent 各自接收引用或工具结果。

## 复用与改进

- 复用 Greensystem 数据 Agent 的 Pi 工具循环、目录优先、每轮调用上限和 PostgreSQL 只读事务。自然语言入口按专题限定工具，模型只提供经 JSON Schema 检查的筛选条件。
- 发布脚本把首批数据写入按专题分区的标准事实表，记录审核指标、来源字段和版本指纹。更新发布指针时保留历史版本。查询回传的 `query` 可以按原版本复现。
- 查询区分空结果、来源缺测和真实零值。`green_agent_ro` 读取目录、语义指标和发布事实，查询不触发问答候选写入。

| 专题 | 首批查询范围 | 口径 |
| --- | --- | --- |
| 气象 | NOAA GFS 全球气温格点均值 | 保留起报和有效时刻。默认选择查询范围内最新已入库起报。 |
| 电力 | 国家统计局月度发电量本期值 | 支持全国和 31 个省级地区、六个电源产品。来源空值保持 `null`。 |
| 碳 | GRACED Power 全球日帧格点排放速率合计 | 单位 `kgC/h`，保留原帧与档案哈希。 |

## 复现

1. 在完成 `scripts/v11-schema-baseline.sql` 的 `zyz` 库中，以 `zyz` 依次执行 `scripts/v11-data-agent-schema.sql` 和 `scripts/v11-data-agent-publish.sql`。发布脚本可以重复执行。
2. 在服务端配置 `DATA_AGENT_DATABASE_URL`。生产环境给 JSON 和 MCP 客户端配置同一个服务端 Bearer token。自然语言入口另需配置 `DATA_AGENT_PI_ENABLED=true` 与 `DEEPSEEK_API_KEY`。
3. `GET /api/data-agent` 读取当前目录。`POST /api/data-agent` 接受 `catalog`、`query` 或 `ask` 操作。Streamable HTTP MCP 路径为 `/api/mcp/data-agent`，提供 `list_published_catalog` 和 `query_published_data`。两种接口使用同一个查询执行器。
4. 运行 `node scripts/verify-v11-data-agent.mjs` 验证三个专题。加 `--pi` 验证自然语言工具调用。

查询响应保留 V11 的 `dataset_id`、`version`、`query_hash`、字段、单位、时间范围与质量信息。首批结果为有行数上限的内联数据，`artifact_uri` 为 `null`。Wren MDL、SQLGlot 校验、pgvector 检索、FastAPI 和 SeaweedFS Parquet 产物属于后续实现。

![三个地球专题的真实发布目录](pr-evidence/v11-data-agent-catalog.jpg)
