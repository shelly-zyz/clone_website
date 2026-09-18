# EnergyIR / GeoIR 能源可信问数首版规格

> 版本：1.0.0
> 日期：2026-09-11
> 用户：能源数据分析师、项目分析人员
> 范围：设施与来源、数据集质量、GFS/GRACED/VRE/OSM/PV图层可用性

## 1. 产品边界

第八步首版不是通用聊天机器人，也不是自然语言转SQL入口。它只处理已经进入正式语义目录的问题，把自然语言绑定为受控的EnergyIR/GeoIR JSON，再由程序选择确定性只读工具并验证结果。任何文字解释只能引用已经通过来源、单位、时间和限制检查的工具结果。

首版允许：

- 查询全国或省级边界内的映射能源设施数量、样本容量字段合计和来源；
- 查询数据集时间范围、更新时间、缺失状态与数据身份；
- 查询GFS、GRACED Power、VRE、OSM与PV遥感足迹图层的当前可用性和覆盖说明；
- 把当前大屏省份、最后选择图层和时间模式作为指代消解上下文；
- 复用已审核、带版本的分析配方。

首版不允许：

- 生成或执行任意SQL、Python、数据库写入、删除、更新或结构变更；
- 输出生产风光预测、P10/P50/P90、跨区调度、实时省级碳强度；
- 把官方统计、映射样本、正式预报、研究估算和模型情景互相改写；
- 把空样本解释为官方为零；
- 自动发布模型猜测的字段含义、表关系或指标口径。

## 2. 信任链

```text
用户问题 + 最近会话 + 大屏上下文
  -> Responses兼容模型规划器（OpenAI或DeepSeek；严格JSON Schema，只输出EnergyIR/澄清/不可用/拒绝）
  -> EnergyIR JSON Schema 校验
  -> 实体、指标、数据集和只读权限校验
  -> 白名单工具路由
  -> 确定性执行（自由 SQL 永远为 null）
  -> 事实、单位、数量级、来源、时间、缺失与限制校验
  -> 结构化回答
```

模型通过Responses API的Structured Outputs生成同一EnergyIR JSON；运行时由`ENERGY_AGENT_PROVIDER`显式选择OpenAI或DeepSeek，并且只读取所选供应商自己的密钥。模型无权选择数据库连接、提交SQL、跳过语义审核或直接撰写未验证结论。接口设置`store: false`，只发送当前问题、当前大屏上下文和最多6条裁剪后的最近会话。模型名称必须由`ENERGY_AGENT_MODEL`显式配置；没有所选供应商密钥和模型时，API与界面明确显示“智能体未配置”，不把规则解析器冒充智能体。DeepSeek当前使用`deepseek-flash`和`https://api.deepseek.com`，结构化规划关闭默认思考模式以避免推理token挤占JSON输出预算。

## 3. EnergyIR 契约

正式模式位于`src/lib/energy-ir/schema.ts`。核心字段如下：

| 字段 | 首版约束 |
|---|---|
| `schemaVersion` | 固定为`1` |
| `operation` | 只能是`read` |
| `intent` / `metric` | 必须来自相同白名单且首版必须一致 |
| `entities.country` | 固定为`CN` |
| `entities.province` | 绑定34个省级名称或当前大屏范围 |
| `entities.technology` | 光伏、陆上/海上风电、水电、核电、煤电、燃气、燃油、地热 |
| `entities.dataset` | mapped-assets、gfs、graced、vre、osm、pv-footprint |
| `time.mode` | none、current、latest、range |
| `groupBy` | 只允许source、technology、province |
| `visualization` | number、table、status |
| `availabilityRequired` | 必须显式提供 |

未知指标、未知数据集、写操作、未知分组和未知图表在工具执行前拒绝。

## 4. 正式语义目录

正式目录位于`src/lib/energy-ir/semantic-catalog.ts`，当前版本`1.0.0`。每项都必须包含来源、单位、数据身份、版本、审核状态、支持工具和限制；时间范围与空间粒度在适用时必填。

| 指标/数据集 | 数据身份 | 单位 | 工具 | 关键限制 |
|---|---|---|---|---|
| 映射设施数量/来源 | mapped-asset-sample | 个、MW、数据源 | mapped-assets | 不是官方普查；空结果不是官方零值 |
| 数据集质量 | 按数据集固定 | 状态/时间 | dataset-catalog | 未记录字段显示未知 |
| 图层可用性 | 按数据集固定 | 状态/范围 | layer-catalog | 可读取不等于业务变量完整 |
| GFS起报/有效时间 | forecast | UTC | weather-manifest | 正式NWP，不是实测或发电预测 |
| 预测门禁 | research-estimate | 状态 | prediction-gate | 首版输出锁定 |
| GRACED Power | research-estimate | kgC/hour | dataset/layer catalog | 研究估算，不是实时监测 |
| VRE | model-scenario | capacity_factor | dataset/layer catalog | 2021—2060长期情景，不是实际发电 |
| OSM | crowdsourced-map | 要素/瓦片 | dataset/layer catalog | 不是调度拓扑，无可信潮流/损耗 |
| PV足迹 | research-estimate | 平方米/足迹 | dataset/layer catalog | 不直接换算官方装机 |

只有`reviewed`或`rule-confirmed`条目可以发布。`candidate`与`rejected`条目会被`publishSemanticCatalog`拒绝，不会进入生产目录。

## 5. 智能体规划、Grounding 与歧义处理

生产主路径由`ResponsesEnergyPlanner`完成语义规划，并由`runEnergyDataAgent`编排模式校验、单次白名单工具调用、结果验证和结构化回答。确定性中文Grounding只保留为40条金标准问题的离线回归基线，不进入生产API主路径。

模型规划器必须遵守：

- 省份：识别34个省级简称；“该省”“当前省份”只能在大屏已选省份时解析；
- 技术：光伏/太阳能、陆上风电、海上风电、水电、核电、煤电、燃气、燃油、地热；
- 数据集：GFS、GRACED、VRE、OSM、PV遥感足迹、映射设施；
- 指代图层：“这个图层”必须存在`selectedLayer`上下文；
- 时间：“最近发电怎么样”等无法绑定数据集和时间口径的问题要求澄清；
- 写入与自由SQL：在模式校验之前立即拒绝；
- 生产预测、调度和实时省级碳强度：返回不可用，不生成替代数值。

## 6. 确定性工具与GeoIR

### 6.1 映射设施

`mapped-assets`只读取`src/lib/china-map-data.generated.json`。省级查询读取已审核的`public/data/china-dashboard/provinces.geojson`，使用点落面算法筛选坐标；技术筛选来自固定枚举。它不接受字段名、表名、SQL片段或任意表达式。

返回：映射设施数、样本容量字段合计或来源列表，以及`mapped-asset-sample`身份。容量合计始终带多源重叠和项目边界限制。

### 6.2 数据集质量与图层状态

- GFS：`.weather-cache/manifest.json`；
- OSM：`public/data/osm-power/summary.json`；
- VRE：`public/data/climate-vre/manifest.json`；
- PV足迹：`public/data/china-pv/solar-footprints-summary.json`；
- GRACED：当前中国大屏本地运行时清单；缺少清单时明确不可用；
- 映射设施：本地构建快照和其中已审核来源元数据。

图层查询只报告当前可读产物、覆盖描述和限制，不把可用状态扩写为完整性、实时性或业务真实性。

## 7. 结果契约

每个成功或数据不可用的工具结果都包含：

- `status`：answered或unavailable；
- `summary`：只引用工具返回的已验证事实；
- `facts`：标签、值、单位；
- `provenance`：来源、数据身份、时间范围、单位、更新时间、限制、可选来源URL；
- `limitations`：面向用户的边界；
- `visualization`：number、table或status。

`agent.server.ts`在工具调用前再次编译和校验模型IR；`validation.ts`在解释展示前强制检查事实单位和完整来源字段。验证失败返回服务错误，不允许降级为无来源文字。最终摘要由确定性工具结果提供，因此模型不能在工具执行后追加未经验证的数字。

API为：

- `GET /api/energy-ir/query`：智能体配置状态、语义目录版本、安全策略与已审核配方；
- `POST /api/energy-ir/query`：接收`question`、可选`context`和最多6条最近`history`，由模型规划器生成IR并返回计划、结果和审计轨迹；问题限制1—300字符。

审计轨迹固定显示`irOnly: true`、`readOnly: true`、`generatedSql: false`，并记录实际白名单工具和结果是否先验证后解释。

## 8. 分析配方

首个审核配方为`mapped-solar-assets-by-province@1.0.0`。它只允许替换省份，指标保持`mapped_asset_count`、技术保持`solar`、图表保持`number`。替换参数不能修改业务定义或注入新工具。

配方当前以只读代码资产版本化。后续如增加审核界面，发布仍必须走相同语义目录门禁，反馈不能直接覆盖正式配方。

## 9. 金标准问题

`src/lib/energy-ir/fixtures.zh.json`固定40条中文问题：

| 类型 | 数量 | 覆盖 |
|---|---:|---|
| 允许并编译 | 28 | 设施数量/来源、时间/更新/缺失、图层可用与覆盖、上下文指代 |
| 数据不可用 | 4 | 15分钟真实预测、明日光伏预测、跨省调度、实时省级碳强度 |
| 要求澄清 | 4 | 模糊时间、未指定数据、未绑定图层、泛化设施请求 |
| 明确拒绝 | 4 | 删除、更新、自由SQL、写入数据库 |

回归测试同时覆盖：未知指标、非read操作、未审核语义发布、配方跨省复用、上下文Grounding、真实广东光伏空间筛选、来源与单位先于解释校验。

## 10. 大屏交互

中国大屏顶部增加“能源问数”入口，打开右侧覆盖面板，不挤压中央地图。面板显示智能体是否配置、模型名、当前省份、最后选择图层和时间模式，提供三个首版问题示例。回答区展示事实表、来源、数据身份、时间、限制和可展开的EnergyIR/执行轨迹。面板保留最多6条裁剪会话用于连续指代；服务端仍会重新清洗。

语音不在本步范围内。第九步如接入语音，只能把识别文本送入同一POST接口，不能建立旁路业务逻辑。

## 11. 验收条件

- 40条金标准问题分类全部通过；
- 模型规划器通过严格Structured Outputs只产生EnergyIR决策，智能体完成真实工具调用循环；
- 缺少模型或密钥时明确显示未配置，规则回归器不进入生产API；
- 未知指标、写入、删除、更新和自由SQL在执行前被拦截；
- 广东映射光伏问题实际读取本地快照并完成省界空间筛选；
- 每个展示结果有单位与完整来源元数据；
- 预测、调度和实时碳问题保持不可用；
- 类型检查、lint、生产构建和浏览器主流程通过；
- 项目驾驶舱、路线图和讨论记录只在上述证据真实存在后标记完成。

## 12. 接口依据

- OpenAI Responses API创建响应与Structured Outputs：<https://developers.openai.com/api/reference/cli/resources/responses/methods/create>。
- DeepSeek Responses API兼容说明与参数支持：<https://api-docs.deepseek.com/guides/responses_api/>。
- DeepSeek Responses API端点定义：<https://api-docs.deepseek.com/api/create-response/>。
- 本实现使用`text.format`严格JSON Schema、`store: false`与显式模型配置；模型不获得数据库连接或自由工具执行权。
