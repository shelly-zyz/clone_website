# OpenGridWorks · DataVista

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-PostGIS%20%7C%20TimescaleDB-4169e1?logo=postgresql)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向**电力能源、气象地球、碳排放与宏观经济**的多源异构三维地理可视化与智能分析平台（站内品牌展示为 **DataVista**，「看见地球的变化」）。

项目基于 Next.js App Router 构建，融合 MapLibre GL、Three.js、ECharts / AntV G2 / VisActor VChart 与 PostgreSQL（PostGIS / TimescaleDB），并按 V11 技术架构通过常驻右下角的「**小云**」统一语音/文本多智能体，将自然语言查数、专题制图、时序预测回测、已审核文档溯源与站内三维交互串联为可追溯、可复现的分析闭环。

---

## 四大三维地球工作区

| 电力地球 | 气象地球 | 碳排放地球 | 经济地球 |
| :---: | :---: | :---: | :---: |
| ![电力地球](public/images/opengridworks/globes/power.webp) | ![气象地球](public/images/opengridworks/globes/weather.webp) | ![碳排放地球](public/images/opengridworks/globes/carbon.webp) | ![经济地球](public/images/opengridworks/globes/economy.webp) |
| `/workspace?topic=power` | `/workspace?topic=weather` | `/workspace?topic=carbon` | `/workspace?topic=economy` |
| 中国电源项目、输电线路与省域三维发电/装机时空分析 | 全球风/洋流/波浪动态地球、ERA5 vs GFS 空间对照与区域 3D 气象回放 | GRACED 全球逐日格点碳排放与 OECD 隐含碳贸易弦图 | 世界银行 WDI 历史指标与 GEP 全球经济增长预测 |

---

## 核心功能

### 1. 开屏粒子地球与多维空间工作区（`/`、`/workspace`）

- **DataVista 开屏粒子地球（`/`）**：基于 WebGL 粒子地球与 NASA Blue Marble / VIIRS 纹理呈现动态开屏，支持动画启停与降级静态海报，直达四大地球工作区与专题分析入口。
- **电力与电网基础设施（`?topic=power`）**：
  - 基于本地 OSM 数据集与 PostGIS 动态矢量瓦片（`/api/data/vector-tiles/postgis/[z]/[x]/[y]`）展示中国电源项目与输电线路。
  - 提供 Three.js 透明省域三维电力热力/尖柱统计图与分省时空分析工作区，支持按年份、指标与省份筛选对比装机容量和发电量。
- **气象地球、空间对照与区域 3D 回放（`?topic=weather`）**：
  - 交互式全球气象地球（基于 `cambecc/earth`）默认开启自动动画，覆盖 NOAA GFS 地表风、OSCAR 洋流与 NOAA GFS-Wave 波浪（主波周期、方向与有效波高）；缺少 `wgrib2` 或无法连接 NOMADS 时自动回退内置示例场。
  - 右栏内置 **ERA5 再分析 vs NOAA GFS 历史预报空间对照**（`T2m`、`U10`、`Z500`、`T850` 同投影同色标联动）及经审核的 **GFS / WRF / ClimaX 区域气象模型预报**。
  - 支持**四大区域 3D 气象回放视图**（云雨结构、降水时空演变、降水热点追踪、累计降水），覆盖 SatWeave 红外亮温、PARDIG 降水估计与多区域 NOAA GFS 历史案例，同时提供独立页面 `/visualization/weather-replay`。
- **碳排放地球与隐含碳贸易网络（`?topic=carbon`）**：
  - 三维地球读取 PostgreSQL 中的 GRACED 全球逐日格点排放帧（`kgC/h`），支持按日期与部门（`total`、`Power`、`Industry`、`Residential`、`GroundTransportation`、`DomesticAviation`、`InternationalAviation`、`InternationalShipping`）切换观测。
  - 切换至二维地图视图（`projection=map`）可探索基于 OECD GHGFP 2025 版（1995–2022 年、80 个单列经济体及 `WXD`）的**全球隐含碳贸易网络弦图**（`/api/carbon-trade`）。
- **宏观经济地球（`?topic=economy`）**：
  - 基于世界银行 World Development Indicators（WDI，2015–2024 年）以固定对数色阶展示各国 GDP、人均 GDP 与商品及服务出口额。
  - 右栏联动展示世界银行 2026 年 6 月版《全球经济展望》（GEP）的 2026–2028 年实际 GDP 年增速预测。

### 2. 九大专题分析工作区与自定义制图（`/visualization`）

专题分析将多年结构化数据组织为 4 大领域、9 个交互工作区，支持多图联动筛选、期间对比、基于程序计算事实的四段式图文洞察（核心发现、结构与趋势、关联分析、结论与依据）以及分析报告导出：

| 领域 | 专题路由 | 名称 | 核心数据与覆盖范围 |
| --- | --- | --- | --- |
| 电力与能源 | `/visualization/power` | 电源装机与发电结构 | 2020–2025 国家统计局年度公报（Three.js 分层装机曲带 + 环图 / 净增量桑基 / 趋势带 / 排序点图） |
| 电力与能源 | `/visualization/generation` | 月度发电与省际比较 | 国家统计局月度发电统计、季节性热力图与各省排行 |
| 电力与能源 | `/visualization/fuels` | 煤、油、气生产 | 2020–2025 原煤、原油、天然气产量及月度变化 |
| 气象与气候 | `/visualization/renewables` | 风光资源与季节互补 | 2021–2060 气候情景下全国与各省风光容量因子 |
| 气象与气候 | `/visualization/weather` | 全球近地面风场 | GFS 预报归档风向玫瑰图、风速分布与纬度对照 |
| 碳排放 | `/visualization/carbon` | 电力部门碳排放 | GRACED 研究估算日度排放速率与纬度/日历分布 |
| 经济与贸易 | `/visualization/economy` | 全球经济规模与人均产出 | 2015–2024 世界银行 WDI 历史数据 |
| 经济与贸易 | `/visualization/trade` | 出口格局与贸易开放度 | 2015–2024 出口规模与出口占 GDP 比重 |
| 经济与贸易 | `/visualization/outlook` | 全球经济增长展望 | 2026–2028 世界银行 GEP 实际 GDP 增速预测 |

每个专题均可通过 `/visualization/[topic]/custom` 进入**自定义制图工作区**，支持按业务指标分步选图、调用小云 Data Storytelling MCP 自动出图与解读、接入 Draw.io 图表编辑，以及在浏览器本地解析 CSV 文件出图。

### 3. 「小云」多智能体与 V11 受控分析闭环

- **「小云」统一语音/文本总 Agent（`/api/xiaoyun`）**：
  - 常驻页面右下角，支持文字输入、浏览器语音识别与语音播报（`@xiaoyun/voice`），在跨页面跳转时保持会话状态。
  - 基于 Pi 运行时（`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`）编排 **19 项受控工具**，涵盖自然语言查数、数据质检与预测预检、图表与单指标驾驶舱生成、异步统计/预测任务管理、地图定位与图层控制、视图筛选联动、站内页面与图表跳转、Three.js 三维实体机制拆解（Anatomy）、已审核文档知识检索与原文证据打开、CSV/JSON 导出及项目命名视图保存/恢复。
  - 支持按需加载运行时技能：`forecast-review`（预测与回测）、`bigdata-dashboard`（全屏数据看板）、`data-storytelling`（故事化制图）与 `anatomy`（三维技术机制拆解）。
- **共用数据库 Agent（`/api/data-agent`、MCP `/api/mcp/data-agent`）**：
  - 基于已审核语义目录与固定 SQL / JSON Schema 校验执行受控查询，运行在 PostgreSQL 只读角色（`green_agent_ro`）下。
  - 严格区分空结果、来源缺测与真实零值，并以不可变 `DataRef`（数据集、版本号、查询哈希、口径与来源指纹）在查数、制图与分析间安全交接。
  - 配套国家统计局月报定时采集脚本与 `/data-review` 人工复核发布台（独立 `green_agent_ingest` / `green_agent_review` 角色与审核令牌）。
- **受控可视化服务（`/api/visualization`、MCP `/api/mcp/visualization`）**：
  - 集成 ECharts（本地 `mcp-echarts`）、VisActor VChart 与 AntV G2 官方前端包，在本地服务端生成可复现的 `VisualizationSpec`、单指标数据看板与 Data Storytelling 图文配置，业务数据不外传第三方渲染服务。
- **异步分析与预测 Worker（`/api/analysis`、MCP `/api/mcp/analysis`、`npm run analysis:worker`）**：
  - 通过 PostgreSQL 任务队列（`results.analysis_job`）异步执行描述统计、KMeans 单变量聚类、时序预测、留出回测与模型对比。
  - 支持锁定版本与权重修订号的 StatsForecast、TimesFM 与 Chronos 模型，具备租约超时控制、项目隔离校验与重复请求复用机制。

---

## 系统架构

```mermaid
flowchart LR
    subgraph Web["前端交互层 (Next.js 16 App Router)"]
        Intro["/ 开屏粒子地球 (DataVista)"]
        Globes["/workspace 四大三维地球工作区"]
        Topics["/visualization 九大专题分析 & 自定义制图"]
        Replay["/visualization/weather-replay 区域 3D 回放"]
        Review["/data-review 入库人工审核台"]
        XYUI["小云语音 / 文本浮窗 (@xiaoyun/voice)"]
    end

    subgraph Agent["V11 智能体与受控服务层 (API & Streamable HTTP MCP)"]
        XY["小云总管 (/api/xiaoyun · Pi Runtime · 19 Tools)"]
        DA["共用数据库 Agent (/api/data-agent · /api/mcp/data-agent)"]
        VA["可视化服务 (/api/visualization · /api/mcp/visualization)"]
        AA["分析调度服务 (/api/analysis · /api/mcp/analysis)"]
        MapAPI["地图 / 瓦片 / 气象 / 碳流 / 专题接口"]
    end

    subgraph Storage["存储与离线计算层"]
        PG[("PostgreSQL\nPostGIS · TimescaleDB\n标准事实 / 语义目录 / 会话 / 任务队列")]
        S3[("S3 兼容对象存储\nSeaweedFS 原始档案与气象回放")]
        Worker["Python 分析 Worker\nStatsForecast · TimesFM · Chronos"]
    end

    Web --> XYUI
    Web --> MapAPI
    Review --> DA
    XYUI --> XY
    XY -->|DataRef| DA
    XY -->|VisualizationSpec| VA
    XY -->|Job Spec| AA
    DA -->|green_agent_ro| PG
    VA -->|项目隔离读取| PG
    AA -->|results.analysis_job| PG
    MapAPI --> PG
    MapAPI --> S3
    Worker -->|green_agent_ingest 抢占任务| PG
```

---

## 技术栈

| 领域 | 技术选型 |
| --- | --- |
| 前端框架 | Next.js 16 (App Router)、React 19、TypeScript 5 (strict) |
| 样式与组件 | Tailwind CSS v4、shadcn/ui、Base UI、Lucide React |
| 地图与三维渲染 | MapLibre GL、Three.js、d3-geo、TopoJSON |
| 图表与可视化 | ECharts 6、AntV G2 5、VisActor VChart 2、`mcp-echarts` |
| 智能体与协议 | `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@modelcontextprotocol/sdk`、`@xiaoyun/voice` |
| 数据与存储 | PostgreSQL（PostGIS、TimescaleDB）、S3 兼容对象存储（SeaweedFS / AWS SDK S3） |
| 离线计算与脚本 | Node.js 24+、Python（`xarray`、`netCDF4`、`numpy`、PyGRIB、StatsForecast / TimesFM / Chronos） |

---

## 页面路由与主要接口

### 页面路由

| 路径 | 用途 |
| --- | --- |
| `/` | DataVista 动态粒子地球开屏页与平台总入口 |
| `/workspace` | 四大三维地球工作区（支持 `?topic=power\|weather\|carbon\|economy`、碳贸易 `projection=map`、气象区域回放等参数） |
| `/visualization` | 专题分析总览页（四大领域、九大专题卡片预览） |
| `/visualization/[topic]` | 单个专题交互分析工作区（`power` / `generation` / `fuels` / `renewables` / `weather` / `carbon` / `economy` / `trade` / `outlook`） |
| `/visualization/[topic]/custom` | 专题自定义制图工作区（分步选图、小云 Data Storytelling、Draw.io、本地 CSV） |
| `/visualization/weather-replay` | 区域 3D 气象回放独立播放器 |
| `/data-review` | 国家统计局等入库批次人工复核与发布页（需独立审核令牌） |

### 主要 API 与 MCP 端点

| 路径 | 用途 |
| --- | --- |
| `/api/xiaoyun`（含 `/status`、`/voice`、`/export`、`/forecast-overview`） | 小云总 Agent 对话、语音、健康状态、项目结果导出与预报总览 |
| `/api/data-agent`、`/api/data-agent/review`、`/api/mcp/data-agent` | 已发布语义目录、受控查询、自然语言问数、批次审核与 Data Agent MCP |
| `/api/visualization`、`/api/visualization/workspace`、`/api/mcp/visualization` | 图表模板渲染、自定义制图、看板生成与可视化 MCP |
| `/api/analysis`、`/api/mcp/analysis` | 描述统计、KMeans 聚类、预测、回测与模型对比任务接口及 MCP |
| `/api/topic-analysis` | 九大专题分析数据与已发布历史序列接口 |
| `/api/weather-earth`、`/api/weather-replay` | 全球气象格点场状态/数据与区域 3D 气象回放档案接口 |
| `/api/carbon-earth`、`/api/carbon-trade` | GRACED 全球逐日碳排放帧与 OECD 全球隐含碳贸易网络接口 |
| `/api/data/vector-tiles/postgis/[z]/[x]/[y]` | PostGIS 电力设施动态矢量瓦片（`.pbf`） |
| `/api/data/map-assets`、`/api/data/geojson`、`/api/data/climate-vre` | 地图资产、地理边界与风光气候情景数据接口 |
| `/api/database/health` | PostgreSQL 数据库连接健康检查 |

---

## 快速开始

### 环境要求

- **Node.js**：`>= 24`（见 `.nvmrc` 与 `package.json`）
- **PostgreSQL**：建议使用 PostGIS 与 TimescaleDB 扩展（完整 V11 数据闭环、碳排放帧、碳贸易与 PostGIS 矢量瓦片需要）
- **可选工具**：
  - `wgrib2`：实时拉取并解析 NOAA GFS 格点场
  - Python 3 环境：用于运行碳排放/气象数据同步脚本及 V11 异步分析预测 Worker

### 本地开发

1. **克隆仓库并安装依赖**

   ```bash
   git clone https://github.com/shelly-zyz/clone_website.git
   cd clone_website
   npm install
   ```

2. **配置环境变量**

   复制 `.env.example` 创建 `.env.local`，按需填写数据库连接、对象存储与模型凭据：

   ```bash
   cp .env.example .env.local
   ```

   > 本地开发启动器（`npm run dev`、`npm run preview:open`）也支持按约定从 `$HOME/.config/opengridworks/`（目录与文件权限 `0600`）读取 `map-database.env`、`data-agent-database.env`、`carbon-trade-database.env`、`weather-replay.env`、`xiaoyun-providers.env` 与 `database-tunnel.env`，避免将任何密钥放入仓库目录。

3. **启动开发服务器**

   ```bash
   npm run dev
   ```

   如需自动恢复已配置的 SSH 数据库隧道、执行本地预检（数据库、发布目录、小云查数与语音）并打开预览：

   ```bash
   npm run preview:open -- 3207
   ```

   如通过私有 SSH 隧道访问远程预览环境：

   ```bash
   npm run preview:ssh
   ```

### Docker 部署

```bash
# 构建并启动生产容器（默认映射 3000 端口）
docker compose up app --build

# 构建并启动开发容器（默认映射 3001 端口）
docker compose up dev --build
```

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 使用本地配置加载器启动 Next.js 开发服务器 |
| `npm run build` | 执行 Next.js 生产构建 |
| `npm run start` | 启动 Next.js 生产服务 |
| `npm run lint` | 运行 ESLint 代码规范检查 |
| `npm run typecheck` | 运行 `next typegen` 与 TypeScript 严格类型检查 |
| `npm run check` | 依次执行 `lint`、`typecheck` 与 `build` |
| `npm run preview:open` | 恢复数据库隧道、运行预检并打开本地预览 |
| `npm run preview:ssh` | 通过私有 SSH 隧道打开远程工作台预览 |
| `npm run check:preview` | 校验预览环境数据库连接、四地球数据与小云服务 |
| `npm run weather:update` | 拉取并更新 `.weather-cache/` 中的 NOAA GFS 气象数据 |
| `npm run carbon:sync` | 下载并预处理 GRACED 碳排放月度数据 |
| `npm run carbon:import` | 将处理后的 GRACED 帧幂等导入 PostgreSQL |
| `npm run analysis:worker` | 启动 V11 异步统计与预测分析 Worker |

---

## 数据库初始化与数据接入

### 1. V11 数据库迁移与校验

在完成 `scripts/v11-schema-baseline.sql` 的目标 PostgreSQL 数据库中，安装对应版本的 PostGIS 与 TimescaleDB 扩展（并在 `shared_preload_libraries` 中启用 TimescaleDB），随后按依赖顺序执行核心迁移脚本：

1. 数据库扩展与基础模式：`scripts/v11-data-agent-extensions.sql` → `scripts/v11-data-agent-schema.sql`
2. 国家统计局与调度审计：`scripts/v11-data-agent-nbs.sql` → `scripts/v11-data-agent-refresh-log.sql`
3. 会话、瓦片与策略：`scripts/v11-data-agent-context.sql` → `scripts/v11-data-agent-tiles.sql` → `scripts/v11-business-agent-context.sql` → `scripts/v11-agent-policy.sql`
4. 小云上下文与工具：`scripts/v11-xiaoyun-context.sql` → `scripts/v11-xiaoyun-tools.sql`
5. 气象回放与区域预报（按需）：`scripts/v11-weather-replay.sql` → `scripts/v11-weather-replay-semantics.sql` → `scripts/v11-weather-replay-payload.sql` → `scripts/v11-weather-replay-rate.sql` → `scripts/v11-weather-model-forecast.sql`
6. 发布既有源表：`scripts/v11-data-agent-publish.sql`

运行内置验证脚本核对 Data Agent、三专题基准与小云工具回归：

```bash
node scripts/verify-v11-data-agent.mjs
node scripts/verify-v11-data-agent-benchmarks.mjs
node --test scripts/verify-v11-xiaoyun.mjs
```

### 2. 多源专题数据同步

- **NOAA GFS 气象数据**：确保 `wgrib2` 在 `PATH` 中可用后执行 `npm run weather:update`（离线或无 `wgrib2` 时自动降级内置示例场）。区域 3D 回放与 WRF/ClimaX 模型预报导入见 [区域气象回放](docs/weather-replay.md) 与 [区域气象预报](docs/weather-model-forecast.md)。
- **GRACED 碳排放日帧**：使用安装有 `xarray`、`netCDF4`、`numpy` 的 Python 环境同步并导入：

  ```bash
  python scripts/sync-carbon-graced.py --sector Power --month 2026-04
  npm run carbon:import -- --manifest "../data/carbon-graced/processed/Power/2026-04/manifest.json"
  ```

- **OECD 全球隐含碳贸易**：配置 `CARBON_TRADE_IMPORT_DATABASE_URL` 后执行 `node scripts/import-oecd-carbon-trade.mjs`（详见 [全球隐含碳贸易网络](docs/carbon-trade.md)）。
- **宏观经济快照（WDI / GEP）**：工作区默认直读站内快照 `public/data/economy/`，可通过 `node scripts/update-economy-globe-data.mjs` 从世界银行 API 刷新（详见 [经济地球](docs/economy-globe.md)）。
- **异步分析预测 Worker**：

  ```bash
  python3 -m venv /opt/opengridworks-analysis/venv
  /opt/opengridworks-analysis/venv/bin/pip install -r scripts/analysis-requirements.txt
  DATA_AGENT_INGEST_DATABASE_URL=postgresql://worker:password@host:5432/zyz \
  OGW_ANALYSIS_PYTHON=/opt/opengridworks-analysis/venv/bin/python \
  OGW_ANALYSIS_DEVICE=cpu npm run analysis:worker
  ```

---

## 项目结构

```text
src/
  app/
    page.tsx                       # DataVista 粒子地球开屏页
    workspace/                     # 四大三维地球工作区路由
    visualization/                 # 九大专题分析、自定义制图与区域 3D 气象回放
    data-review/                   # 入库批次人工审核台
    api/                           # 小云、Data Agent、可视化、分析、MCP 与专题/地图接口
  components/
    opengridworks/                 # 粒子开屏、四地球视图、碳流弦图、三维省域电力图与小云组件
    ui/                            # shadcn/ui 基础组件
  lib/
    xiaoyun/                       # 小云总 Agent 运行时、19 项工具与按需技能
    data-agent/                    # 语义目录、固定 SQL 查询与项目会话
    visualization-agent/           # 多引擎图表模板、看板与 Data Storytelling 封装
    analysis-agent/                # 统计、聚类、预测回测预检与任务队列
    topic-analysis/                # 九大专题分析数据构建与四段式洞察生成
    weather-replay/                # 区域 3D 气象回放处理、剖面与热点追踪
    agent-runtime/                 # Pi 运行时与受控工具循环基础封装
scripts/                           # V11 SQL 迁移、数据同步/导入脚本、分析 Worker 与回归验证脚本
docs/                              # V11 架构、工具契约、专题说明与阶段验收文档
public/                            # 静态地球纹理、开屏素材、专题快照与地图数据
deepagent/                         # 早期 DeepAgent 兼容实现
vendor/                            # 本地语音交互包（@xiaoyun/voice）
```

---

## V11 交付进度与延伸文档

本项目按 V11 技术方案分六阶段推进，源码基线保留在 Git 标签 `pre-proposal-v11-20261107`：

- **阶段 1–4（建立基线、数据闭环、可视化闭环、算法闭环）**：核心业务能力已完成服务器与本地回归验收，实测记录见 [V11 前四阶段验收记录](docs/v11-phase-1-4-acceptance.md)。
- **阶段 5–6（知识与调度、交互与试运行）及扩展能力**：小云 19 项工具、知识证据检索、区域 3D 气象回放、OECD 隐含碳贸易弦图与科研制图工作区持续完善与联调中。

### 专题与架构文档

- [V11 共用数据库 Agent](docs/v11-data-agent.md)
- [V11 小云业务说明（可视化与分析预测）](docs/v11-visualization-analysis-agents.md)
- [小云总 Agent 工具与站内动作](docs/v11-xiaoyun-tools.md)
- [Agent 业务规则与预测验收](docs/v11-agent-policy.md)
- [V11 前四阶段验收记录](docs/v11-phase-1-4-acceptance.md)
- [区域气象回放说明](docs/weather-replay.md)
- [区域气象模型预报说明](docs/weather-model-forecast.md)
- [全球隐含碳贸易网络说明](docs/carbon-trade.md)
- [经济地球与世界银行数据说明](docs/economy-globe.md)
- [可视化审计与研究参考](docs/visualization-audit.md)

---

## 数据来源与开源协议

- **开源协议**：本项目基于 [MIT License](LICENSE) 开源。
- **公开数据与上游致谢**：OpenStreetMap（电力设施与底图）、国家统计局与国家能源局（电力与能源统计）、NOAA GFS / GFS-Wave、Copernicus Climate Change Service ERA5（经 WeatherBench 2）、Google DeepMind / Google Research（SatWeave & PARDIG，CC BY 4.0）、GRACED（全球逐日碳排放）、OECD GHGFP 2025（全球隐含碳贸易）、World Bank WDI & GEP（CC BY 4.0）、NASA Blue Marble / VIIRS 以及 [`cambecc/earth`](https://github.com/cambecc/earth)。
