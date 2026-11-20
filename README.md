# OpenGridWorks

面向电力能源、气象地球与碳排放的交互式三维地图、专题可视化与多智能体（V11）分析平台。

项目基于 Next.js App Router 构建，集成 MapLibre GL、Three.js、ECharts / AntV G2 / VChart 与 PostgreSQL（PostGIS / TimescaleDB），通过「小云」统一语音/文本智能体串联数据查询、图表生成、时序预测回测与站内导航。

## 核心功能

- **多专题三维地球与地图**：
  - **电力与电网基础设施**：展示中国电源项目与输电线路（基于本地 OSM 数据集与 PostGIS 动态矢量瓦片），支持省级统计与装机/发电量交互筛选。
  - **气象地球与回放**：基于 NOAA GFS 格点场渲染全球风场、气温等气象要素，支持 `/visualization/weather-replay` 时序回放；无法连接 NOMADS 或缺少 `wgrib2` 时自动降级为内置示例场。
  - **碳排放地球**：基于 PostgreSQL 中存储的 GRACED Power 全球逐日格点帧（`kgC/h`），支持按日期与部门切换观察。
  - **宏观经济专题**：提供全球经济体指标三维地球与对比分析工作台。
- **「小云」多智能体与语音交互（`/api/xiaoyun`）**：
  - 右下角常驻交互入口，支持文本与浏览器语音输入/播报。
  - 基于 Pi 运行时与站内工具集，支持自然语言查数、地图定位与图层开关、页面跳转、Three.js 三维技术机制拆解（Anatomy），以及已审核文档的证据检索与原文溯源。
- **V11 数据、可视化与分析闭环**：
  - **共用数据库 Agent（`/api/data-agent`、MCP `/api/mcp/data-agent`）**：基于已审核语义目录与固定 SQL / 受控查询，按版本快照与 `DataRef` 交接电力、气象、碳三大专题数据；支持国家统计局（NBS）月度数据定时采集与 `/data-review` 人工复核发布。
  - **可视化服务（`/api/visualization`、MCP `/api/mcp/visualization`）**：支持 ECharts、VChart、AntV 单指标模板出图、Data Storytelling 自定义制图（含四段式文字解读）与可全屏数据看板。
  - **异步分析与预测 Worker（`/api/analysis`、`npm run analysis:worker`）**：通过 PostgreSQL 任务队列（`results.analysis_job`）执行描述统计、KMeans 聚类、StatsForecast 时序预测与回测，并保留模型参数、数据版本与误差指标。

## 技术栈

| 领域 | 技术选型 |
| --- | --- |
| 前端框架 | Next.js 16 (App Router)、React 19、TypeScript 5 |
| 样式与组件 | Tailwind CSS v4、shadcn/ui、Base UI、Lucide React |
| 地图与三维渲染 | MapLibre GL、Three.js、d3-geo、TopoJSON |
| 图表与可视化 | ECharts 6、AntV G2 5、VisActor VChart、mcp-echarts |
| 智能体与协议 | `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@modelcontextprotocol/sdk`、`@xiaoyun/voice` |
| 数据与存储 | PostgreSQL（PostGIS、TimescaleDB）、S3 兼容对象存储（气象回放） |
| 离线计算与脚本 | Python（`xarray`、`netCDF4`、`numpy`、StatsForecast）、Node.js 24+ |

## 页面路由与主要接口

| 路径 | 用途 |
| --- | --- |
| `/` | 主地图应用与三维地球入口 |
| `/workspace` | 综合分析工作台 |
| `/visualization`、`/visualization/[topic]` | 电力、气象、碳、经济专题可视化与自定义制图 |
| `/visualization/weather-replay` | 气象格点时序回放播放器 |
| `/data-review` | 国家统计局等入库批次的人工审核页面（需审核令牌） |
| `/api/xiaoyun` | 小云对话、语音与状态接口 |
| `/api/data-agent`、`/api/mcp/data-agent` | 已发布指标目录、自然语言查数与 MCP 端点 |
| `/api/visualization`、`/api/mcp/visualization` | 图表渲染与可视化 MCP 端点 |
| `/api/analysis`、`/api/mcp/analysis` | 统计、聚类、预测与回测任务接口 |
| `/api/weather-earth`、`/api/carbon-earth` | 气象地球与碳排放地球数据接口 |
| `/api/data/vector-tiles/postgis/[z]/[x]/[y]` | PostGIS 电力设施动态矢量瓦片 |
| `/api/database/health` | 数据库连接健康检查 |

## 快速开始

### 环境要求

- **Node.js**：24+（见 `.nvmrc` 与 `package.json`）
- **PostgreSQL**：建议搭配 PostGIS 与 TimescaleDB 扩展（完整 V11 数据库与矢量瓦片能力需要）
- **可选工具**：
  - `wgrib2`：用于拉取并解析 NOAA GFS 实时气象场
  - Python 环境：用于运行 `scripts/sync-carbon-graced.py` 及分析 Worker

### 本地开发

1. **安装依赖**

   ```bash
   npm install
   ```

2. **配置环境变量**

   参考 `.env.example` 创建 `.env.local`，按需填写数据库连接与模型凭据：

   ```bash
   cp .env.example .env.local
   ```

   > 本地开发脚本 `npm run dev` 与 `npm run preview:open` 也会按约定从 `$HOME/.config/opengridworks/` 读取 `map-database.env`、`data-agent-database.env`、`xiaoyun-providers.env` 与 `database-tunnel.env`（仅用户可读权限 `0600`），避免将密钥放入仓库目录。

3. **启动开发服务器**

   ```bash
   npm run dev
   ```

   如需自动恢复 SSH 数据库隧道并执行本地预检后打开浏览器：

   ```bash
   npm run preview:open -- 3207
   ```

### Docker 部署

```bash
# 构建并运行生产容器（默认映射 3000 端口）
docker compose up app --build

# 运行开发容器（默认映射 3001 端口）
docker compose up dev --build
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 使用本地配置加载器启动 Next.js 开发服务器 |
| `npm run build` | 执行 Next.js 生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run lint` | 运行 ESLint 代码检查 |
| `npm run typecheck` | 运行 `next typegen` 与 TypeScript 类型检查 |
| `npm run check` | 依次执行 `lint`、`typecheck` 与 `build` |
| `npm run preview:open` | 恢复数据库隧道、运行预检并打开本地预览 |
| `npm run preview:ssh` | 通过私有 SSH 隧道打开远程工作台预览 |
| `npm run weather:update` | 拉取并更新 `.weather-cache/` 中的 GFS 气象数据 |
| `npm run carbon:sync` | 下载并预处理 GRACED 碳排放月度数据 |
| `npm run carbon:import` | 将处理后的 GRACED 帧导入 PostgreSQL |
| `npm run analysis:worker` | 启动 V11 异步统计与预测分析 Worker |

## 数据接入与数据库初始化

### 1. 数据库初始化与 V11 迁移

在完成 `scripts/v11-schema-baseline.sql` 的目标数据库中，依次执行 `scripts/` 下的 V11 初始化与发布脚本（需先安装对应 PostgreSQL 版本的扩展并配置 TimescaleDB）：

1. `scripts/v11-data-agent-extensions.sql`
2. `scripts/v11-data-agent-schema.sql`
3. `scripts/v11-data-agent-nbs.sql`
4. `scripts/v11-data-agent-refresh-log.sql`
5. `scripts/v11-data-agent-context.sql`
6. `scripts/v11-data-agent-tiles.sql`
7. `scripts/v11-xiaoyun-context.sql`
8. `scripts/v11-data-agent-publish.sql`

验证 Data Agent 与三专题基准数据：

```bash
node scripts/verify-v11-data-agent.mjs
node scripts/verify-v11-data-agent-benchmarks.mjs
```

### 2. 气象数据（NOAA GFS）

气象地球从 NOAA NOMADS 获取 GFS 格点场并缓存在 `.weather-cache/`。运行更新前需确保 `wgrib2` 在当前 Shell 的 `PATH` 中可用：

```bash
wgrib2 -version
npm run weather:update
```

当 `wgrib2` 不可用或无法访问 NOMADS 时，`/api/weather-earth?request=status` 会返回状态说明，前端将自动回退至内置演示场。

### 3. 碳排放数据（GRACED）

碳排放地球从 PostgreSQL 读取逐日 GRACED 帧。先使用包含 `xarray`、`netCDF4` 与 `numpy` 的 Python 环境准备数据：

```bash
python scripts/sync-carbon-graced.py --sector Power --month 2026-04
```

随后导入生成的 manifest 与压缩日帧（幂等写入 `website_data.carbon_emission_frames`，支持 `total`、`Power`、`Industry`、`Residential`、`GroundTransportation`、`DomesticAviation`、`InternationalAviation`、`InternationalShipping`）：

```bash
npm run carbon:import -- --manifest "../data/carbon-graced/processed/Power/2026-04/manifest.json"
```

## 项目结构

```text
src/
  app/
    page.tsx                  # 主地图入口
    workspace/                # 综合分析工作台
    visualization/            # 专题可视化、自定义制图与气象回放
    data-review/              # 数据入库审核台
    api/                      # 小云、Data Agent、可视化、分析、MCP 与地图数据接口
  components/
    opengridworks/            # 地球视图、小云助手、能源/气象/经济业务组件
    ui/                       # 基础 UI 组件（shadcn/ui）
  lib/
    xiaoyun/                  # 小云总 Agent 运行时、技能与工具编排
    data-agent/               # 语义目录、固定查询与会话管理
    visualization-agent/      # 图表模板与 Data Storytelling 封装
    analysis-agent/           # 统计、聚类与预测任务调度
    weather-replay/           # 气象回放数据处理与读取
    topic-analysis/           # 专题分析计算与解读生成
scripts/                      # SQL 迁移、数据同步/导入脚本、Worker 与 V11 验证脚本
docs/                         # V11 架构、工具契约、气象回放与验收文档
public/                       # 静态资源、地图数据、音频与示例文件
deepagent/                    # 早期 DeepAgent 兼容实现
vendor/                       # 本地语音包（@xiaoyun/voice）
```

## 延伸文档

- [V11 共用数据库 Agent](docs/v11-data-agent.md)
- [V11 小云业务说明](docs/v11-visualization-analysis-agents.md)
- [小云总 Agent 工具与站内动作](docs/v11-xiaoyun-tools.md)
- [Agent 业务规则与预测验收](docs/v11-agent-policy.md)
- [V11 前四阶段验收记录](docs/v11-phase-1-4-acceptance.md)
- [气象回放说明](docs/weather-replay.md)
- [气候与可再生能源数据](docs/weather-model-forecast.md)

## 许可证

[MIT](LICENSE)
