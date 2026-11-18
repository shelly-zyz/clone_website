# 全球隐含碳贸易网络

碳排放工作区的 `projection=map` 打开年度贸易网络，URL 中的 `year`、`country` 和 `tradeDirection` 可复用。三维地球的数据仍通过 GRACED 接口读取，使用 `date` 和 `sector`。

数据来自 OECD GHGFP 2025 版。双边采用 `TRADE_GHG / _T / TTL`（所有活动、全部产品），按出口方、进口方记录。80 个单列经济体和 `WXD`（世界其他地区）形成互斥节点，`W`（全球总计）和同经济体记录排除。主指标使用 `PROD_GHG` 与 `FD_GHG`；全球足迹直接使用 OECD 的 `W` 观测。两份表的来源单位为 `T_CO2E`、倍数为 `10^6`，界面统一显示 Mt CO₂e。贸易衡量商品及服务贸易总额内含的排放，同一供应链中的商品跨境多次会产生多条记录。贸易流合计不能用作全球足迹总量。

## 导入 PostgreSQL

在受控环境注入具有建表及写入权限的 `CARBON_TRADE_IMPORT_DATABASE_URL` 后，运行导入命令。

```sh
node scripts/import-oecd-carbon-trade.mjs
```

命令读取 OECD SDMX。若已下载相同数据集的两份 SDMX CSV，可按「双边贸易、主指标」的顺序传入两个路径。脚本校验单位、主键唯一性和 1995–2022 年完整覆盖，在同一事务内更换已发布记录。发布记录保存源查询与输入文件组合的 SHA-256。

部署时向前端运行角色授予 `carbon_trade` 模式的 `USAGE` 和三个表的 `SELECT`。接口默认通过 `DATABASE_URL` 查询。使用独立数据库时设置 `CARBON_TRADE_DATABASE_URL`，本机开发可从权限为 `0600` 的 `~/.config/opengridworks/carbon-trade-database.env` 加载。访问 `/api/carbon-trade` 检查目录，再用 `?year=2022` 检查流量。2022 年中国至美国的观测值为 445.381 Mt CO₂e。
