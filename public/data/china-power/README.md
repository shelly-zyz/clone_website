# 中国电力统计地图边界

- 省级多边形、海南以南岛屿和南海界线来自 [coastal-climate-dashboard 的 china-full.json](https://github.com/shelly-zyz/coastal-climate-dashboard/blob/cb522ca58836ff011bbe88cfe6c5a2991c32d4f3/public/data/china-full.json)。保留原坐标及名称、行政区代码和中心点。
- 市县辅助线来自 [ditu-viewer 的矢量边界](https://github.com/rovvv9098-dev/ditu-viewer/tree/b5ede83d57305a26396b96f49c5cf98759c0e5c7/geo)。使用同省不同市、同市不同县共享的线段，去掉外轮廓并去重。二进制文件中每段按小端 Float32 存储两个端点的经纬度，经度在前。

## 分省发电量

`ember-annual.json`（2011–2025 年）和 `ember-monthly.json`（2016-01 至 2026-09）是 [Ember China Electricity Data](https://ember-energy.org/data/china-electricity-data/) 2026-11-11 版的公开快照，遵循 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。两份源 CSV 覆盖全国和 31 个省级地区：

- [年度 CSV](https://files.ember-energy.org/public-downloads/generation/outputs/release_chn_subnational_generation_yearly.csv)
- [月度 CSV](https://files.ember-energy.org/public-downloads/generation/outputs/release_chn_subnational_generation_monthly.csv)
- [Ember 估算方法](https://storage.googleapis.com/emb-prod-bkt-publicdata/public-downloads/ember_china_generation_methodology.pdf)

构建时只抽取总量、分电源和占比所需的发电量列，保留 TWh、源 CSV 的 SHA-256 和数据发布日期。页面把 TWh 换算为亿千瓦时。手动更新快照的命令：

```bash
python3 scripts/build-power-ember-snapshot.py yearly.csv monthly.csv --release YYYY-MM-DD
```

Ember 为第三方估算；尤其是分布式光伏和 1–2 月拆分存在估算。全国年度值与各省年度值之和可能不同。应用读取来源提供的全国值；年内累计只在各月连续有记录时相加，不与年度值或国家统计局规上工业月报拼接。分省缺值保留为空。装机仍使用中电联统计年鉴年末存量，双期差值表示净变化，不能据此计算新增投产量或容量因子。
