# 中国电力统计地图边界

- 省级多边形、海南以南岛屿和南海界线来自 [coastal-climate-dashboard 的 china-full.json](https://github.com/shelly-zyz/coastal-climate-dashboard/blob/cb522ca58836ff011bbe88cfe6c5a2991c32d4f3/public/data/china-full.json)。保留原坐标及名称、行政区代码和中心点。
- 市县辅助线来自 [ditu-viewer 的矢量边界](https://github.com/rovvv9098-dev/ditu-viewer/tree/b5ede83d57305a26396b96f49c5cf98759c0e5c7/geo)。使用同省不同市、同市不同县共享的线段，去掉外轮廓并去重。二进制文件中每段按小端 Float32 存储两个端点的经纬度，经度在前。
