// Province centers and ISO labels are from the bundled Natural Earth boundaries.
// Statistical codes use the two-digit province prefix with ten zeroes.
export const chinaProvinces = [
  { iso: "CN-BJ", code: "110000000000", name: "北京市", center: [116.389, 39.9488] },
  { iso: "CN-TJ", code: "120000000000", name: "天津市", center: [117.347, 39.3708] },
  { iso: "CN-HE", code: "130000000000", name: "河北省", center: [115.314, 38.5205] },
  { iso: "CN-SX", code: "140000000000", name: "山西省", center: [112.389, 37.7586] },
  { iso: "CN-NM", code: "150000000000", name: "内蒙古自治区", center: [111.623, 41.5938] },
  { iso: "CN-LN", code: "210000000000", name: "辽宁省", center: [123.07, 41.386] },
  { iso: "CN-JL", code: "220000000000", name: "吉林省", center: [126.466, 43.2978] },
  { iso: "CN-HL", code: "230000000000", name: "黑龙江省", center: [127.97, 46.8451] },
  { iso: "CN-SH", code: "310000000000", name: "上海市", center: [121.409, 31.0909] },
  { iso: "CN-JS", code: "320000000000", name: "江苏省", center: [119.942, 32.9844] },
  { iso: "CN-ZJ", code: "330000000000", name: "浙江省", center: [119.97, 29.1084] },
  { iso: "CN-AH", code: "340000000000", name: "安徽省", center: [117.253, 31.9537] },
  { iso: "CN-FJ", code: "350000000000", name: "福建省", center: [118.178, 26.408] },
  { iso: "CN-JX", code: "360000000000", name: "江西省", center: [116.017, 27.6397] },
  { iso: "CN-SD", code: "370000000000", name: "山东省", center: [118.114, 36.3271] },
  { iso: "CN-HA", code: "410000000000", name: "河南省", center: [113.484, 33.9055] },
  { iso: "CN-HB", code: "420000000000", name: "湖北省", center: [112.264, 30.9857] },
  { iso: "CN-HN", code: "430000000000", name: "湖南省", center: [111.712, 27.6667] },
  { iso: "CN-GD", code: "440000000000", name: "广东省", center: [113.72, 23.7924] },
  { iso: "CN-GX", code: "450000000000", name: "广西壮族自治区", center: [108.756, 23.7451] },
  { iso: "CN-HI", code: "460000000000", name: "海南省", center: [109.825, 19.1865] },
  { iso: "CN-CQ", code: "500000000000", name: "重庆市", center: [107.73, 30.0173] },
  { iso: "CN-SC", code: "510000000000", name: "四川省", center: [102.384, 30.5431] },
  { iso: "CN-GZ", code: "520000000000", name: "贵州省", center: [106.559, 26.8033] },
  { iso: "CN-YN", code: "530000000000", name: "云南省", center: [101.661, 24.4603] },
  { iso: "CN-XZ", code: "540000000000", name: "西藏自治区", center: [88.4137, 31.4515] },
  { iso: "CN-SN", code: "610000000000", name: "陕西省", center: [108.363, 33.7713] },
  { iso: "CN-GS", code: "620000000000", name: "甘肃省", center: [100.735, 38.7393] },
  { iso: "CN-QH", code: "630000000000", name: "青海省", center: [96.2377, 35.2652] },
  { iso: "CN-NX", code: "640000000000", name: "宁夏回族自治区", center: [106.038, 37.1762] },
  { iso: "CN-XJ", code: "650000000000", name: "新疆维吾尔自治区", center: [85.4253, 41.122] },
] satisfies { iso: string; code: string; name: string; center: [number, number] }[];

export function findChinaProvince(region: string | undefined) {
  const id = region?.toUpperCase();
  return chinaProvinces.find(province => province.iso === id || province.code === id || province.code.slice(0, 6) === id);
}

export function chineseLabelMatches(label: string, query: string) {
  const normalize = (name: string) => name.trim().toLowerCase().replace(/(?:壮族|回族|维吾尔)?自治区$|[省市]$/u, "");
  return normalize(label) === normalize(query);
}
