# 第九步：小云本地部署

日期：2026-09-16。基于 personoj/xiaoyun-voice v1.0.0-beta.1（dffee06f24f189b20f5f2c806b7a0ee45006b1da）。项目适配包为 `vendor/xiaoyun-voice-1.0.0-beta.1-power-earth.3.tgz`；协议仍兼容 1.0.0-beta.1。第三方素材声明保留在包中。

## 启动

在项目目录运行 `npm run dev:voice`，或双击上一级目录的 `start-power-voice.cmd`。网站为 http://127.0.0.1:3000/china，小云后台为 http://127.0.0.1:8765。生产模式使用 `npm run build` 后运行 `npm run start:voice`；启动器会复用 `.next/standalone/server.js` 并注入被 Git 忽略的 `.env.local`，不会把密钥写入构建产物。

新安装时先运行 `npm install` 和 `npx xiaoyun init`。若配置文件不存在，复制 `.env.xiaoyun.example` 为 `.env.xiaoyun`，填写私有密钥和 Python 3.12+ 路径。Next.js 的 DeepSeek 和 PostgreSQL 配置仍位于 `.env.local`，小云后台配置位于 `.env.xiaoyun`。两个文件均被 Git 忽略，禁止复制到 public 或添加 NEXT_PUBLIC 前缀。

## 使用

- `/china`启动时默认挂载并显示小云角色；此前组件被错误地放在“能源问数”面板的条件渲染分支中，导致页面启动后完全没有助手。默认 Qwen 原生实时语音；麦克风默认关闭。点击角色开始，悬停角色后可使用文字输入、麦克风开关。角色可拖动。
- “切换到广东”等操作与地图按钮使用同一个回调。状态变化会同步完整上下文。
- 能源数据调用 `voice-project.mjs` 的只读 `energy_query`，再进入同一 `/api/energy-ir/query`：DeepSeek 生成 EnergyIR，白名单编译器校验，确定性工具查询，返回带来源的结果。
- 设施数量和来源从现有 `website_data.energy_assets` 读取，以项目省界进行空间筛选；不会在数据库失败时悄悄改用快照。气象/图层工具继续注明其现有清单或快照来源。
- 可切换为浏览器语音备用模式；此模式不需要 Qwen。浏览器的识别服务可能联网，不声称离线识别。文字问数默认不自动朗读，开启麦克风或主动重播后才播报。
- 浏览器模式的新输入取消旧请求和播报；关闭或离开页面停止识别。原生模式沿用小云的插话、结果排队、播报排空和告别行为。
- 任务状态数据库为小云内部 SQLite，能源业务数据库仍是项目 PostgreSQL，不加载销售演示数据。任务和日志保存在被忽略的 `.xiaoyun/`。

## 本地适配

原组件保留角色、拖动、动效与结果卡。增加 `ui.theme: 'power-earth'` 深色青色主题；增加可取消的 `browserAdapter` 接口；修复 Next.js 对静态资源目录的打包解析；CLI 将包版本与原生协议版本分开核验。修改源码在同级 `xiaoyun-voice/`，可重新构建和打包后安装。

## 验收与限制

DeepSeek `/models` 和实际 EnergyIR 规划已验证；Qwen WebSocket 已返回 `session.created` 与 `session.updated`。原生 Qwen 文字指令实际切换地图到山东，调用 `project__energy_query` 经 DeepSeek 返回 GFS 结果，并收到浏览器 `playback.finished`。浏览器备用模式实际切换到广东并返回同一 GFS 来源结果。类型检查、20 项 EnergyIR 测试、7 项语音测试及生产构建通过；上游 46 项行为测试及新增浏览器识别关闭后事件隔离测试通过。全项目 lint 无错误，保留原有 transfer-raw-files-to-server.mjs 未使用变量警告。

原生首次完整会话曾出现连接超时，重试后完整链路通过；出现此提示可重新开启，或切换浏览器备用模式。Qwen 事件协议参考 [官方服务端事件文档](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-server-events)。DeepSeek 接口按[官方 API 说明](https://api-docs.deepseek.com/)配置，实际规划使用 Responses 兼容接口。

PostgreSQL 曾连接超时，随后恢复并通过健康检查；原生 Qwen 入口已用“广东有多少已映射光伏设施”完成复测，从 zyz 的 website_data.energy_assets 返回 188 个光伏设施样本，并收到 playback.finished。结果截图位于工作区 output/playwright/xiaoyun-postgres-result.png。保留用户原文的回归测试通过，防止 Qwen 把光伏问数改写为全部能源设施问数。代码连接现有配置，不创建替代数据库、不修改服务器。真实麦克风的听感、声学回声和用户设备权限需要在用户机器点击测试，自动化结果不等同于真人语音验收。
