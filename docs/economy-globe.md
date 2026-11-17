# 经济地球

经济地球读取随站发布的 [世界发展指标快照](../public/data/economy/wdi.json)。快照覆盖 2015–2024 年，上游更新日期随指标登记。界面保留现价美元口径，按国家或地区、指标和年份显示数据。[World Bank, World Development Indicators](https://datacatalog.worldbank.org/infrastructure-data/search/dataset/0037712/world-development-indicators)

| 指标 | 代码 | 单位 |
| --- | --- | --- |
| [GDP](https://data.worldbank.org/indicator/NY.GDP.MKTP.CD) | `NY.GDP.MKTP.CD` | 现价美元 |
| [人均 GDP](https://data.worldbank.org/indicator/NY.GDP.PCAP.CD) | `NY.GDP.PCAP.CD` | 现价美元/人 |
| [商品与服务出口额](https://data.worldbank.org/indicator/NE.EXP.GNFS.CD) | `NE.EXP.GNFS.CD` | 现价美元 |

导出排除全球和收入组等集合，按三字母代码匹配 Natural Earth 底图，保留缺测为 `null`。中文名称取自底图并整理显示用名称，指标值保留上游精度。三项指标各用固定的对数色阶，便于切换年份时比较。数据许可为 CC BY 4.0。[世界银行数据使用条款](https://data.worldbank.org/summary-terms-of-use)

运行 `node scripts/update-economy-globe-data.mjs` 可用 `curl` 从世界银行 Indicators API 重新生成快照。工作区直接读取站内文件。

右栏展示世界银行 2026 年 6 月版 [全球经济展望](https://www.worldbank.org/en/publication/global-economic-prospects) 的实际 GDP 年增速预测。站内 [GEP 快照](../public/data/economy/gep.json) 从该版 `GEP_CSV.zip` 的 `GEPCSV.csv` 取指标 `NYGDPMKTPKDZ` 和 2026–2028 年列，按 WDI 国家编码匹配，并保留世界银行成员全球合计 `WLT`。缺测保留为空，快照登记原压缩包 SHA-256。数据许可为 CC BY 4.0。[世界银行数据目录](https://datacatalog.worldbank.org/search/dataset/0037888/global-economic-prospects)

底部缩略图取自各专题的地球渲染。碳排放缩略图取自 [GRACED 实帧截图](pr-evidence/carbon-earth-latest.png)。
