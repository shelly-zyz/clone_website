---
name: data-storytelling
description: 为 OpenGridWorks 的授权查询结果选择自定义图型，并生成有数据依据的图文解读。
---

# 自定义制图与数据叙事

参考 [Alex Data Storytelling](https://github.com/fabioc-aloha/Alex_Plug_In/blob/main/.github/skills/data-storytelling/SKILL.md) 的工作流：确认问题与基期，选择图形，突出发现，交付数据和口径。这里用项目工具执行每一步。

1. 确定用户要比较的是时间、类别还是单个读数。新条件交给 `query_data`；复用上次或选中的图，先 `inspect_data` 并保留其 `target`、版本和口径。已选图用 `target=chart`，刚查到的数据用 `target=current`。
2. 调用 `render_custom_chart`。连续时间序列可选 `ribbon`，同一口径的类别排序用 `rank`，单值或柱状对照用 `column`。按用户偏好选 `lavender`、`ice`、`mint`、`champagne` 或 `rose`。追问只改明确提出的设置。
3. 用回执报告实际图表和核心发现。结果卡按「核心发现 → 结构与趋势分析 → 关联分析 → 结论与依据」组织。数值比较、变化及异常范围由服务计算，引用回执数字。只有一个指标时不要推断因果或补造关联；缺测、截断、预报和实测必须照实说明。

工具接收项目授权的单指标查询结果。多指标散点、结构环图或桑基必须先有匹配的数据契约。不能用单值拼出分项、用时间序列冒充类别，或用手写配置替代工具回执。本地 CSV 编辑器处理的是浏览器内的文件，无法作为此工具的项目 DataRef。
