# 地球筛选与可视化专题参考

## Globe 侧栏

左侧窄栏用黑底、细分隔线和线框图标组织操作。标题和简短数据说明在上方，地区下拉与视图按钮紧接其后。栏底的 Atlas 标识是独立的导航入口。OpenGridWorks 沿用这个顺序，把当前专题的筛选集中在侧栏，并把「专题分析」固定在栏底。

- [地球视图](globe.jpg)
- [展开国家筛选](globe-country-filter.jpg)
- [切换到平面地图](globe-map-view.jpg)

原站 HTML 和 CSS 用于布局核对，交互截图来自可在本地运行的官方归档。[Globe 原站](http://globe.cid.harvard.edu/) · [Harvard Growth Lab 官方归档](https://github.com/harvard-growth-lab/globe)

## Atlas 首页

深蓝首屏把标题、简述和地球分成左右两列。下方四个入口分别通向贸易探索、国家档案、增长预测和复杂度排名。标题、简述和预览帮助读者按分析任务进入下一层。[Atlas 首页](https://atlas.hks.harvard.edu/)

- [首页首屏](atlas-home.jpg)
- [下方专题卡片](atlas-entries.jpg)

## Atlas 内页调研

2026 年 11 月 12–13 日从官方站点截取五个视图，用于核对入口层级、筛选位置和图表呈现。

| 截图 | 内容和交互 |
| --- | --- |
| [Atlas 首页](atlas-home-current.jpg) | 贸易探索、国家档案、增长预测和排名入口。 |
| [贸易构成](atlas-trade-composition.jpg) | 顶部选择出口方、进口方、年份和商品分类。矩形面积编码贸易额，悬停可读分类、金额和份额。[原页](https://atlas.hks.harvard.edu/explore/treemap) |
| [历年贸易趋势](atlas-trade-over-time.jpg) | 通过起止年份和产品类别观察贸易总量与结构变化。时间图与构成图共用左侧视图导航。[原页](https://atlas.hks.harvard.edu/explore/overtime) |
| [产品空间](atlas-product-space.jpg) | 关系网络显示产品所需能力的相似程度，节点可选，图例解释节点大小与颜色。[原页](https://atlas.hks.harvard.edu/explore/productspace) |
| [国家档案](atlas-country-analysis.jpg) | 左侧围绕出口篮子、增长、市场份额和多样化推进叙事。右侧将统计说明、参数、气泡图和进一步探索入口放在一起。[原页](https://atlas.hks.harvard.edu/countries/340/growth-dynamics) |

OpenGridWorks 用四个专题入口和独立分析页对应这两层。分析页顶部显示数据范围和筛选项，侧栏可跳到不同分析问题，正文并列展示可悬停、切换和展开读数的图表。图表标题写明分析对象，来源和口径随图标注。

## 专题图表的数据

- **电力**采用 2024 和 2025 年全国统计，装机以 GW、发电量以 TWh 显示。装机构成矩形按公开列出的五类电源绘制，年末装机总量沿用公报原值。[2024 年装机](https://www.nea.gov.cn/20250121/097bfd7c1cd3498897639857d86d5dac/c.html) · [2024 年发电量](https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html) · [2025 年公报](https://www.stats.gov.cn/sj/zxfb/202602/t20260228_1962662.html)
- **气象**使用项目归档的 GFS 1°、10 米风场。以 U、V 分量计算风速，用格点中心纬度余弦近似面积权重。八方位分布按风的来向统计，风速低于 0.5 m/s 的格点从该图的分母中排除。[NOAA GFS](https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast)
- **碳排放**使用 GRACED Power 的 2025 年 8 月日度网格，聚合全球速率、纬度带速率和非零格点数。风场和碳排放的汇总都登记原文件 SHA-256，可用 `python scripts/build-topic-analysis.py --graced <GRACED Power NetCDF>` 重建。GRACED 方法见 Dou 等人发表于 *Scientific Data* 的研究。[GRACED 数据](https://carbonmonitor-graced.com/datasets.html) · [研究论文](https://www.nature.com/articles/s41597-023-01963-0)
- **经济**使用站内 2015–2024 年 WDI 快照及世界银行 2026 年 6 月版 GEP。WDI 的 GDP 和出口是现价美元，GEP 展示实际 GDP 增速预测，缺测值保持为空。[WDI](https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators) · [全球经济展望](https://www.worldbank.org/en/publication/global-economic-prospects)
