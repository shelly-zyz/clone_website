# 经济地球

经济地球读取随站发布的 [世界发展指标快照](../public/data/economy/wdi.json)。快照覆盖 2015–2024 年，上游更新日期随指标登记。界面保留现价美元口径，按国家或地区、指标和年份显示数据。[World Bank, World Development Indicators](https://datacatalog.worldbank.org/infrastructure-data/search/dataset/0037712/world-development-indicators)

| 指标 | 代码 | 单位 |
| --- | --- | --- |
| [GDP](https://data.worldbank.org/indicator/NY.GDP.MKTP.CD) | `NY.GDP.MKTP.CD` | 现价美元 |
| [人均 GDP](https://data.worldbank.org/indicator/NY.GDP.PCAP.CD) | `NY.GDP.PCAP.CD` | 现价美元/人 |
| [商品与服务出口额](https://data.worldbank.org/indicator/NE.EXP.GNFS.CD) | `NE.EXP.GNFS.CD` | 现价美元 |

导出排除全球和收入组等集合，按三字母代码匹配 Natural Earth 底图，保留缺测为 `null`。中文名称取自底图并整理显示用名称，指标值保留上游精度。三项指标各用固定的对数色阶，便于切换年份时比较。数据许可为 CC BY 4.0。[世界银行数据使用条款](https://data.worldbank.org/summary-terms-of-use)

运行 `node scripts/update-economy-globe-data.mjs` 可用 `curl` 从世界银行 Indicators API 重新生成快照。工作区直接读取站内文件。

底部缩略图取自各专题的地球渲染。碳排放缩略图取自 [GRACED 实帧截图](pr-evidence/carbon-earth-latest.png)。
