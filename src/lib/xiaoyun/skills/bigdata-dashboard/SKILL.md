---
name: bigdata-dashboard
description: 用 OpenGridWorks 已发布数据生成可全屏查看的单指标看板。
---

# 数据看板

- 用户要求新指标、地区或日期时，先用 `query_data` 查询一个专题和指标。只传取数要求。查询成功后用 `render_dashboard`，`target` 设为 `current`。
- 用户要求把已有结果做成看板时，用 `inspect_data` 查看引用。选中了图表就用 `target=chart`，引用上次查数就用 `target=data`。用相同的 `topic` 和 `target` 调用 `render_dashboard`。沿用原始数据版本和筛选条件。
- 时间趋势可选 `line`，同月各省对比或单值用 `bar`。沿用图表服务的单位和发布口径。结果卡包含图表、数据覆盖、质量、版本和来源，可全屏查看。
- 多指标或跨专题请求，先请用户选定本次要展示的主题和指标。遇到缺少筛选条件、无有效结果或全缺测时，按查询回执向用户说明。
- 本技能的输入为项目查询结果。用户问到 Excel/JSON 导入、独立 HTML 下载或演示数据时，说明当前入口支持项目内看板。
