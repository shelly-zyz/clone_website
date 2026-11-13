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

## 专题图表的数据

- **电力**采用 2020–2025 年全国统计公报，装机以 GW、发电量以 TWh 显示。装机矩形按公开列出的五类电源绘制，年末装机总量沿用公报原值。[全国统计公报](https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/index.html)
- **气象**使用项目归档的 GFS 1°、10 米风场。以 U、V 分量计算风速，用格点中心纬度余弦近似面积权重。八方位分布按风的来向统计，风速低于 0.5 m/s 的格点从该图的分母中排除。[NOAA GFS](https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast)
- **碳排放**使用 GRACED Power 的 2025 年 8 月日度网格，聚合全球速率、纬度带速率和非零格点数。风场和碳排放的汇总都登记原文件 SHA-256，可用 `python scripts/build-topic-analysis.py --graced <GRACED Power NetCDF>` 重建。GRACED 方法见 Dou 等人发表于 *Scientific Data* 的研究。[GRACED 数据](https://carbonmonitor-graced.com/datasets.html) · [研究论文](https://www.nature.com/articles/s41597-023-01963-0)
- **经济**使用站内 2015–2024 年 WDI 快照及世界银行 2026 年 6 月版 GEP。WDI 的 GDP 和出口是现价美元，GEP 展示实际 GDP 增速预测，缺测值保持为空。[WDI](https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators) · [全球经济展望](https://www.worldbank.org/en/publication/global-economic-prospects)

## 专题工作区

专题首页使用深蓝总览、分类导航与实时图表预览。专题页的左侧导航切换主图，顶部控制年份、指标和地区，概览保留同专题的配套图表。图例、色标、悬停详情和数值表用于核对图形编码。四个原专题地址继续可用，新增月度发电、煤油气、风光资源、贸易和增长展望。

月度发电、煤油气及 GRACED 历史图通过 `GET /api/topic-analysis` 读取固定的公开统计指标。接口以 `DATA_AGENT_DATABASE_URL` 的只读角色查询已审核发布版本。省际图随全国月度数据的版本及月份读取，GRACED 月值为有值日帧的平均速率并保留日帧计数。风光情景优先读取 `DATABASE_URL` 对应的现有情景文档，使用 GFDL-ESM4 / SSP126 情景。页面标出来源和版本。

本地预览可使用 2020–2025 年国家统计局年度公报、2024 年 9 月至 2026 年 9 月间 21 期规模以上工业生产月报、站内气候及碳归档，以及世界银行 WDI 和 GEP 快照。月报选录保留来源地址及原始月度单位，1–2 月合报留空。年度公报与规模以上工业月报使用各自发布口径。分省发电和多年 GRACED 视图在发布库暂不可用时标明数据状态。月度和年度样本的逐期出处见 `src/lib/topic-analysis/nbs-monthly.json` 和 `src/lib/topic-analysis/nbs-annual.json`。
