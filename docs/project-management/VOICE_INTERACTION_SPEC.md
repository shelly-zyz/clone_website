# Unit 9：全双工语音交互规格

> 2026-09-16 更新：现已接入小云原生 Qwen 实时语音 + DeepSeek，并保留浏览器语音备用模式。部署、数据边界和本轮验收见 [小云本地部署](XIAOYUN_LOCAL_DEPLOYMENT.md)。以下首版浏览器方案作为历史设计记录；不再代表默认语音引擎。

> 日期：2026-09-14
> 状态：首版已实现并完成生产构建与隔离浏览器契约验收
> 范围：中国电力大屏的能源可信问数面板

## 1. 产品边界

语音是文字问数的可选输入/输出层，不是第二套智能体。普通语音问题保留识别原文并调用同一个`/api/energy-ir/query`；服务端仍由EnergyDataAgent生成和校验EnergyIR、调用白名单只读工具并验证来源与单位。语音不能直接访问数据库、执行SQL或绕过数据可用性门禁。

首版只提供浏览器内语音识别与合成，不上传或保存原始音频。浏览器实现可能使用远端识别服务，因此界面必须明确提示这一点。`SpeechRecognition`并非所有主流浏览器都支持；不支持、权限拒绝、音频设备缺失和网络错误均显示可恢复状态，文字问数始终保留。

## 2. 用户模式

| 模式 | 麦克风 | AI播报 | 行为 |
|---|---|---|---|
| 默认纯文字 | 关闭 | 静音 | 不采集声音，文字输入和回答正常工作 |
| 语音输入/文字回答 | 开启 | 静音 | 识别文字送入EnergyDataAgent，不朗读结果 |
| 全双工 | 开启 | 开启 | 监听保持开启；回答播报期间出现新语音时立即取消旧播报并处理新输入 |
| 文字输入/语音回答 | 关闭 | 开启 | 用户可手工输入，并朗读通过验证的结果或受控状态消息 |

## 3. 状态机

`voice-state.ts`定义六个显式采集状态：

- `off`：默认状态，没有活动识别实例；
- `starting`：用户点击后，浏览器正在请求权限并启动识别；
- `listening`：麦克风正在监听；
- `processing`：最终识别文本已经分类，正在执行界面指令或提交问数；
- `error`：权限、设备、网络、无语音或启动失败；
- `unsupported`：浏览器没有`SpeechRecognition`或`webkitSpeechRecognition`。

关闭麦克风会调用识别实例的`abort()`并清除实例引用。关闭面板或组件卸载时也会停止识别、取消播报，并中止仍在进行的问数请求。

## 4. 识别与插话

识别器使用`zh-CN`、`continuous: true`、`interimResults: true`和单候选结果。任何非空中间或最终识别结果都会先调用`speechSynthesis.cancel()`；该调用会立即停止当前朗读并清空待播队列，因此可作为首版插话机制。

最终文本按以下顺序处理：

1. 检查是否为审核过的简单界面指令；
2. 省份指令复用地图按钮的`applyScope`回调；
3. “关闭问数面板”执行本地关闭动作；
4. 其他文本保持原文，交给同一个EnergyDataAgent请求函数；
5. 新问题中止上一条仍在进行的HTTP请求，避免旧回答覆盖新回答；
6. 只朗读已验证的工具摘要或受控错误/不可用消息。

当前简单指令只覆盖全国、新疆、内蒙古、四川、山东、广东范围切换和关闭问数面板。图层控制、预测、调度、写入和自由SQL不建立语音旁路。

## 5. 隐私与安全

- 麦克风和AI播报默认关闭；
- 只有用户点击后才创建并启动识别实例；
- 本站不读取、编码、上传或持久化原始音频；
- 识别文本沿用问数接口的300字符问题限制、上下文清洗和最多6条裁剪会话；
- 浏览器或其识别服务可能处理音频，具体行为由浏览器实现和权限策略决定；
- 页面关闭、面板关闭或用户关闭麦克风时停止采集；
- 未配置EnergyDataAgent时麦克风按钮禁用，不收集无法处理的语音。

## 6. 浏览器能力依据

- MDN `SpeechRecognition`：<https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition>；该接口为有限可用，部分浏览器可能把音频发送给服务端识别引擎。
- MDN `continuous`：<https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous>。
- MDN `interimResults`：<https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults>。
- MDN `speechSynthesis.cancel()`：<https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/cancel>；会立即停止当前朗读并清空队列。

## 7. 验收条件

- 默认状态没有麦克风采集且AI播报静音；
- 关闭麦克风后识别事件不会进入问数链路；
- 普通识别问题原样进入EnergyDataAgent；
- 省份语音指令与地图按钮使用同一范围更新函数；
- 新语音会取消旧播报，并可中止旧问数请求；
- 识别失败可重试，且不影响文字问数；
- 不支持语音识别的浏览器显示明确不可用状态；
- 语音不能绕过EnergyIR、只读策略或结果验证；
- 类型检查、状态机测试、生产构建和浏览器交互验证通过。

## 8. 当前验收证据

- `npm run validate:voice`：6项状态机与分类测试通过；
- TypeScript类型检查、lint和生产构建通过；
- 真实未配置环境：麦克风按钮禁用、播报默认静音、无音频采集；
- 浏览器原生权限拒绝：显示可重试错误，文字问数保持可用；
- 隔离契约环境：假的持续识别器进入监听；中间结果触发播报取消；“切换到广东”更新地图和问数上下文；GFS语音问题触发同一个`POST /api/energy-ir/query`并朗读受控摘要；关闭麦克风恢复`off`；
- 截图：`output/playwright/china-dashboard-unit9-voice-default-1440x900.png`与`output/playwright/china-dashboard-unit9-voice-contract-1440x900.png`。

本轮没有使用真实麦克风音频或真实模型凭据，因此不把浏览器契约夹具称为真实语音服务/模型联网验收。生产浏览器中另有预测回测接口因当前服务器PG不可达返回503；它按既有逻辑保持预测锁定，与语音链路无关。
