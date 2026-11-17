import { z } from "zod";
import { findChinaProvince } from "@/lib/china-provinces";
import { globeTopicOrder, workspaceHref } from "@/lib/globe-topics";
import { analysisHref, analysisTopicOrder, analysisTopics } from "@/lib/topic-analysis/catalog";
import { fuelSeries, generationSeries } from "@/lib/topic-analysis/history";
import { replayRegions } from "@/lib/weather-replay/regions";
import { replayViewOrder, replayViews } from "@/lib/weather-replay/views";

const pageIds = ["home", "analysis", "weather-replay", "data-review"] as const;
const globeIds = globeTopicOrder.map(topic => `globe-${topic}` as const);
const customIds = analysisTopicOrder.map(topic => `custom-${topic}` as const);
export const siteViewIdSchema = z.enum([...pageIds, ...globeIds, ...analysisTopicOrder, ...customIds]);
export type SiteViewId = z.infer<typeof siteViewIdSchema>;

type View = {
  title: string;
  href: string;
  aliases?: readonly string[];
  coverage?: string;
  sections?: Record<string, string>;
  filters?: Record<string, string>;
};

const commonEconomicFilters = { country: "经济体 ISO3 代码", year: "结束年份（2015–2024）", startYear: "起始年份（2015–2024）" };
const topics: Record<typeof analysisTopicOrder[number], Pick<View, "coverage" | "sections" | "filters">> = {
  power: {
    coverage: "全国年度电源装机与发电结构，2020–2025 年。各省发电量和装机地图请用 globe-power。",
    sections: { "capacity-comparison": "多年装机走势", "capacity-share": "装机组成", "capacity-waterfall": "装机增量",
      "capacity-mix": "装机组成", "generation-by-source": "分电源发电排行", "renewable-capacity-share": "多年风光占比" },
    filters: { year: "2020–2025", source: "thermal-power / hydro-power / nuclear-power / wind-power / solar-power / other" },
  },
  generation: {
    coverage: "月度长期走势和季节图为全国口径。省级筛选用于同月省际排行及比较，不能展示省级多年走势。",
    sections: { "generation-history": "全国月度发电走势", "generation-seasonal": "月度热力图", "generation-flow": "电源流向",
      "monthly-mix": "当月电源构成", "province-ranking": "同月省际排行", "province-comparison": "同月省际比较" },
    filters: { year: "YYYY，图表限定年份", month: "YYYY-MM，所选月份", product: generationSeries.map(item => item.id).join(" / "),
      region: "省级 ISO 代码，仅同月省际排行或比较" },
  },
  fuels: {
    sections: { "fuel-production": "多年年度产量", "fuel-index": "不同品种相对变化", "fuel-yoy": "年度增速",
      "fuel-monthly": "全国月度产量历史", "fuel-change": "历年产量增量" },
    filters: { fuel: fuelSeries.map(item => item.id).join(" / ") },
  },
  weather: {
    coverage: "GFS 归档近地面风速、风向和纬度分布。云雨回放走 weather-replay，按指定时段查风速走数据库。",
    sections: { "wind-directions": "风向玫瑰", "wind-speed-distribution": "风速分布", "wind-by-latitude": "纬度对照" },
    filters: { region: "global / north / south" },
  },
  renewables: {
    coverage: "中国全国或省级，2021–2060 年气候情景下的风、光容量因子。",
    sections: { "renewable-history": "风光容量因子四十年走势", "renewable-heatmap": "季节热力图",
      "renewable-distribution": "月度分布", "renewable-complementarity": "风光互补", "renewable-regions": "省际资源对比" },
    filters: { year: "2021–2060", region: "china 或省级 ISO 代码", technology: "wind / solar" },
  },
  carbon: {
    coverage: "GRACED 全球电力部门排放速率。多年走势依赖已发布历史，归档日度覆盖 2025 年 8 月。",
    sections: { "carbon-monthly": "全球排放多年走势", "carbon-seasonal": "月度热力图", "emission-trend": "归档日度走势",
      "emission-calendar": "排放日历", "emission-by-latitude": "所选日纬度", "emission-latitude-heatmap": "纬度热力图",
      "emission-grid-count": "非零格点", "carbon-grid-history": "格点长期变化", "carbon-comparison": "地区口径固定的双时期比较" },
    filters: { date: "YYYY-MM-DD，观察日", month: "YYYY-MM，观察月" },
  },
  economy: {
    sections: { "gdp-trend": "GDP 总量走势", "gdp-per-capita": "人均 GDP 走势", "gdp-map": "全球经济地图",
      "gdp-ranking": "经济规模排行", "economic-comparison": "经济体对比（页面内可选对照）" },
    filters: { ...commonEconomicFilters, metric: "gdp / perCapita" },
  },
  trade: {
    sections: { "exports-trend": "出口规模历史", "exports-share": "出口占 GDP 比重走势", "exports-mix": "出口规模格局",
      "export-relationship": "开放度气泡图", "economic-comparison": "经济体出口对比（页面内可选对照）" },
    filters: commonEconomicFilters,
  },
  outlook: {
    coverage: "世界银行已发布的实际 GDP 增速预测，2026–2028 年。",
    sections: { "growth-outlook": "预测增长路径", "growth-range": "预测增速区间", "growth-comparison": "经济体对照",
      "growth-ranking": "预测增速排行" },
    filters: { country: "经济体 ISO3 代码，全球 WLT", targetYear: "2026–2028" },
  },
};

const pages = {
  home: { title: "首页", href: "/", aliases: ["首页", "主页", "网站首页", "开屏", "home", "homepage"] },
  analysis: { title: "专题分析总览", href: "/visualization", aliases: ["专题分析", "专题分析总览", "可视化分析"] },
  "weather-replay": { title: "区域 3D 回放", href: "/visualization/weather-replay", aliases: ["区域3D回放", "区域回放", "云雨回放"],
    coverage: "SatWeave 和 PARDIG 的西北大西洋档案", filters: { region: Object.keys(replayRegions).join(" / ") } },
  "data-review": { title: "数据批次审核", href: "/data-review", aliases: ["数据批次审核", "数据审核"], coverage: "仅打开审核入口，页面需要独立的审核令牌。" },
  "globe-power": { title: "电源地球", href: workspaceHref("power"), aliases: ["工作台", "电力地球", "电源地球", "地图工作台"],
    filters: { powerView: "facilities / generation / capacity", region: "省级 ISO 代码（省级发电/装机统计）", projection: "map（省级统计使用三维中国地图）" } },
  "globe-weather": { title: "气象地球", href: workspaceHref("weather"), aliases: ["气象地球", "气象地图"],
    filters: { replay: replayViewOrder.map(view => `${view}（${replayViews[view].title}）`).join(" / ") } },
  "globe-carbon": { title: "碳排放地球", href: workspaceHref("carbon"), aliases: ["碳排放地球", "碳地球", "碳排放地图"],
    filters: { projection: "globe / map", date: "YYYY-MM-DD，观察日" } },
  "globe-economy": { title: "经济地球", href: workspaceHref("economy"), aliases: ["经济地球", "经济地图", "经济体档案"],
    filters: { country: "经济体 ISO3 代码", scene: "outlook（经济地球的增长展望）" } },
} satisfies Record<typeof pageIds[number] | typeof globeIds[number], View>;

const views = new Map<SiteViewId, View>();
for (const page of [...pageIds, ...globeIds]) views.set(page, pages[page]);
for (const id of analysisTopicOrder) {
  const { title, label, description } = analysisTopics[id];
  const href = analysisHref(id);
  views.set(id, { title, href, aliases: [label, title], ...topics[id], coverage: topics[id].coverage ?? description });
  views.set(`custom-${id}`, { title: `${label} · 自定义制图`, href: href + "/custom", coverage: "用小云将授权指标制成图文报告，或在浏览器内手动制作 CSV 图表。" });
}

export function siteViewCatalog() {
  return Array.from(views, ([view, { title, aliases, coverage, sections, filters }]) =>
    ({ view, title, aliases, coverage, sections, filters }));
}

const year = z.int().min(1900).max(2200);
const iso3 = z.string().regex(/^[A-Z]{3}$/);
const region = z.string().regex(/^(?:[a-z]{2,12}|CN-[A-Z]{2}|[0-9]{12})$/);
export const siteNavigationSchema = z.strictObject({
  view: siteViewIdSchema,
  section: z.string().regex(/^[a-z][a-z-]{1,42}$/).optional(),
  filters: z.strictObject({
    country: iso3.optional(), year: year.optional(), startYear: year.optional(), targetYear: year.optional(), region: region.optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), date: z.iso.date().optional(),
    product: z.enum(generationSeries.map(item => item.id)).optional(), fuel: z.enum(fuelSeries.map(item => item.id)).optional(),
    source: z.enum(["thermal-power", "hydro-power", "nuclear-power", "wind-power", "solar-power", "other"]).optional(),
    technology: z.enum(["wind", "solar"]).optional(), metric: z.enum(["gdp", "perCapita"]).optional(),
    powerView: z.enum(["facilities", "generation", "capacity"]).optional(), projection: z.enum(["globe", "map"]).optional(),
    scene: z.literal("outlook").optional(), replay: z.enum(["weather", "time", "rain", "accumulation", "radar", "wind"]).optional(),
  }).optional(),
});

export type SiteNavigation = z.infer<typeof siteNavigationSchema>;

export function resolveSiteNavigation(action: SiteNavigation) {
  const { view, section, filters = {} } = action;
  const target = views.get(view);
  if (!target || (section && !Object.hasOwn(target.sections ?? {}, section))) return;
  const entries = Object.entries(filters);
  if (entries.some(([key]) => !Object.hasOwn(target.filters ?? {}, key))) return;
  const { year, startYear, targetYear, region, month, date, powerView, projection } = filters;
  if (month && date || startYear && year && startYear > year) return;
  if (view === "generation" && year && month && !month.startsWith(`${year}-`)) return;
  if (year && (view === "power" && (year < 2020 || year > 2025)
    || view === "renewables" && (year < 2021 || year > 2060)
    || (view === "economy" || view === "trade") && (year < 2015 || year > 2024))) return;
  if (startYear && (startYear < 2015 || startYear > 2024) || targetYear && (targetYear < 2026 || targetYear > 2028)) return;
  if (view === "globe-power" && (region || projection) && powerView !== "generation" && powerView !== "capacity") return;
  if (region && (view === "weather" && !["global", "north", "south"].includes(region)
    || view === "weather-replay" && !Object.hasOwn(replayRegions, region)
    || view === "renewables" && region !== "china" && !findChinaProvince(region)
    || (view === "generation" || view === "globe-power") && !findChinaProvince(region)
    || view === "generation" && section !== "province-ranking" && section !== "province-comparison")) return;

  const url = new URL(target.href, "https://site.invalid");
  for (const [key, value] of entries) url.searchParams.set(key, String(value));
  if (view === "globe-power" && (powerView === "generation" || powerView === "capacity")) {
    url.searchParams.set("projection", "map");
  }
  if (section) url.hash = section;
  return { href: url.pathname + url.search + url.hash,
    label: section ? `${target.title} · ${target.sections?.[section]}` : target.title };
}

export function detectSiteView(pathname: string, search: string): SiteViewId | undefined {
  if (pathname === "/workspace") {
    const topic = new URLSearchParams(search).get("topic");
    return globeIds.find(id => id === "globe-" + topic) ?? "globe-power";
  }
  return siteViewIdSchema.options.find(view => views.get(view)?.href === pathname);
}

export function directSiteNavigation(message: string): SiteNavigation | undefined {
  const name = message.trim().replace(/[。！!\s]/g, "")
    .replace(/^(?:小云[,，]?)?(?:请)?(?:帮我|给我)?(?:切换到|切到|跳转到|跳到|前往|返回|回到|回|进入|打开|查看|去|看看|我想看|想看)/i, "")
    .replace(/(?:吧|一下)$/g, "");
  const view = siteViewIdSchema.options.find(id => views.get(id)?.aliases?.some(alias => alias.replace(/\s/g, "").toLowerCase() === name.toLowerCase()));
  return view ? { view } : undefined;
}


export function generationNavigation(message: string, active?: { view: SiteViewId; search: string }): SiteNavigation | undefined {
  const digits = "零一二三四五六七八九";
  const normalized = message.normalize("NFKC").replace(/[\s，,。！!？?]/g, "")
    .replace(/[零〇一二三四五六七八九]{4}(?=年)/g, text => [...text].map(char => digits.indexOf(char === "〇" ? "零" : char)).join(""))
    .replace(/(十[一二]?|[一二三四五六七八九])(?=月)/g, text => String(text.startsWith("十") ? 10 + (text[1] ? digits.indexOf(text[1]) : 0) : digits.indexOf(text)));
  const full = /^(?:请)?(?:我想|想|帮我|给我)?(?:打开|查看|看看?|显示)((?:19|20|21)\d{2})年(?:(1[0-2]|0?[1-9])月)?(?:的)?(?:全国)?(?:总)?发电量(?:走势|趋势)?(?:吧|一下)?$/.exec(normalized);
  const onGeneration = active?.view === "generation";
  const changeYear = onGeneration && /^(?:那就|那|换成|切到|改成|改为|看)?((?:19|20|21)\d{2})年(?:的呢|呢|吧)?$/.exec(normalized);
  const changeMonth = onGeneration && /^(?:那就|那|换成|切到|改成|改为|看)?(1[0-2]|0?[1-9])月(?:的呢|呢|吧)?$/.exec(normalized);
  if (!full && !changeYear && !changeMonth) return;
  const search = new URLSearchParams(active?.search);
  const year = Number(full?.[1] || (changeYear && changeYear[1]) || search.get("year") || search.get("month")?.slice(0, 4));
  if (!year) return;
  const month = full?.[2] || (changeMonth && changeMonth[1]);
  const product = !full && siteNavigationSchema.shape.filters.unwrap().shape.product.safeParse(search.get("product")).data;
  return { view: "generation", section: "generation-history", filters: {
    year, ...(month && { month: `${year}-${month.padStart(2, "0")}` }), ...(product && { product }),
  } };
}
