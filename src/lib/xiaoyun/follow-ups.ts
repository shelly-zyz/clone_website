import { z } from "zod";
import { analysisTopicOrder, analysisTopics } from "@/lib/topic-analysis/catalog";
import { siteViewCatalog, type SiteNavigation, type SiteViewId } from "./site-views";

/** Markdown links with this href are sent back to Xiaoyun as the user's next message. */
export const followUpHref = "#xiaoyun-ask";

const suggestion = z.string().trim().min(2).max(40);
export const followUpSchema = z.strictObject({
  question: z.string().trim().min(2).max(120),
  accept: suggestion,
  suggestions: z.array(suggestion).max(4),
});
export type FollowUp = z.infer<typeof followUpSchema>;

const affirmative = /^(?:好|好的|好啊|好呀|要|要的|需要|可以|行|行啊|嗯|嗯嗯|是的|对|来吧|麻烦了|麻烦你了|帮我|请|继续|ok|okay|yes)(?:的|吧|呀|啊|哦|，?谢谢|，?麻烦了)?$/i;
const negative = /^(?:不用|不要|不需要|不了|算了|先不用|暂时不用|没有了|没了|不用了|no)(?:了|吧|，?谢谢)?$/i;

export function replyToOffer(message: string) {
  const text = message.trim().replace(/[。！!？?，,~\s]/g, "");
  return affirmative.test(text) ? "accept" : negative.test(text) ? "decline" : undefined;
}

function clean(text: string) {
  return text.replace(/[[\]()<>`*_|\\\n\r]/g, "").trim();
}

function offer(question: string, ...suggestions: string[]): FollowUp {
  const unique = [...new Set(suggestions.map(clean).filter(item => item.length >= 2))].slice(0, 3);
  return { question, accept: unique[0] ?? "介绍一下网站的功能", suggestions: unique };
}

/** Appends the follow-up question and clickable next steps to a card summary. */
export function withFollowUp(summary: string, followUp: FollowUp | undefined) {
  if (!followUp) return summary;
  const question = summary.includes(followUp.question) ? "" : followUp.question;
  const links = followUp.suggestions.map(item => `[${clean(item)}](${followUpHref})`).join(" · ");
  return [[summary, question].filter(Boolean).join(" "), links && `你可以直接点：${links}`].filter(Boolean).join("\n\n");
}

/** Text for speech synthesis: the question is read aloud, the clickable list is not. */
export function speakable(text: string) {
  return text.split(/\n\s*\n/).filter(part => !part.includes(followUpHref)).join("\n")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").trim();
}

/** Reads the closing question and the「建议：」line the model is asked to end with. */
export function splitModelFollowUp(text: string) {
  const lines = text.split(/\r?\n/);
  const index = lines.findLastIndex(line => /^\s*(?:[-*]\s*)?(?:\*\*)?建议(?:\*\*)?[:：]/.test(line));
  if (index < 0) return { body: text.trim() };
  const suggestions = lines[index].replace(/^[^:：]*[:：]/, "").split(/[|｜/、；;]/).map(clean).filter(item => item.length >= 2 && item.length <= 40);
  const body = lines.filter((_, i) => i !== index).join("\n").trim();
  const sentences = body.match(/[^。！？!?\n]+[？?]/g) ?? [];
  const question = sentences.at(-1)?.trim();
  if (!question || !suggestions.length) return { body };
  // The model does not always list the proposed action first; accept the suggestion closest to the question.
  const pairs = (text: string) => new Set(Array.from(text.slice(1), (char, index) => text[index] + char));
  const asked = pairs(question);
  const overlap = (item: string) => [...pairs(item)].filter(pair => asked.has(pair)).length;
  const best = suggestions.reduce((top, item) => overlap(item) > overlap(top) ? item : top);
  return {
    body: body.slice(0, body.lastIndexOf(question)).trim() || body,
    followUp: offer(question, best, ...suggestions),
  };
}

type ViewContext = { view: SiteViewId; section?: string; filters?: SiteNavigation["filters"] };

function period(filters: ViewContext["filters"]) {
  if (filters?.month) return `${filters.month.slice(0, 4)}年${Number(filters.month.slice(5))}月`;
  if (filters?.date) return filters.date;
  if (filters?.year) return `${filters.year}年`;
}

const views: Partial<Record<SiteViewId, (context: ViewContext) => FollowUp>> = {
  home: () => offer("要不要我带你快速了解一下网站能做什么？", "介绍一下网站的功能", "打开电源地球", "看全国发电量走势"),
  analysis: () => offer("要不要我推荐几个值得先看的专题？", "推荐几个值得先看的专题", "看全国发电量走势", "看全球电力碳排放走势"),
  "weather-replay": () => offer("要不要我讲讲这段回放里云雨是怎么移动的？", "解读这段云雨回放", "切换到降水累计", "打开气象地球"),
  "data-review": () => offer("要不要我说明一下数据审核的流程？", "数据审核流程是什么", "打开专题分析总览"),
  "globe-power": () => offer("要不要我帮你定位到某个省份，看它的发电和装机情况？", "定位到广东看发电量", "切换到装机统计", "看全国电源装机结构"),
  "globe-weather": () => offer("要不要我打开区域云雨回放，看看天气是怎么演变的？", "打开区域3D回放", "看全球近地面风场", "风电和风速有什么关系"),
  "globe-carbon": () => offer("要不要我解读一下全球电力部门碳排放的分布？", "解读全球电力碳排放分布", "看全球排放多年走势", "看排放日历"),
  "globe-economy": () => offer("要不要我对比几个主要经济体的 GDP？", "对比中国和美国的GDP", "看全球经济增长展望", "看经济规模排行"),
  power: ({ filters }) => offer(`要不要我解读一下${period(filters) ?? "近几年"}电源结构的变化，比如风光占比？`,
    `解读${period(filters) ?? "近几年"}电源结构变化`, "看多年风光占比", "看分电源发电排行"),
  generation: ({ section, filters }) => {
    const when = period(filters);
    const rankingMonth = filters?.month ? `看${when}各省发电排行` : "看最新月份各省发电排行";
    return section === "province-ranking" || section === "province-comparison"
      ? offer(`要不要我解读${when ?? "这个月"}各省发电量的排名差异？`, `解读${when ?? "当月"}各省发电排名`, "看全国月度发电走势", "看当月电源构成")
      : offer(`要不要我详细解读${filters?.year ? `${filters.year}年` : when ? `${when.slice(0, 4)}年` : "近几年"}全国发电量的走势和季节规律？`,
        `解读${filters?.year ? `${filters.year}年` : when ? `${when.slice(0, 4)}年` : "近几年"}全国发电量走势`, rankingMonth, "预测未来6个月全国发电量");
  },
  fuels: () => offer("要不要我解读一下煤、油、气产量这几年的变化？", "解读煤油气产量变化", "看年度增速", "看全国月度产量历史"),
  weather: () => offer("要不要我讲讲风向玫瑰和风速分布该怎么看？", "解读风向玫瑰和风速分布", "看纬度对照", "打开区域3D回放"),
  renewables: ({ filters }) => offer(`要不要我解读${period(filters) ?? "未来"}风光资源的季节互补性？`, "解读风光季节互补", "看省际资源对比", "看风光容量因子长期走势"),
  carbon: ({ filters }) => offer(`要不要我解读${period(filters) ?? "近几年"}全球电力碳排放的走势？`, "解读全球电力碳排放走势", "看排放日历", "看月度热力图"),
  economy: () => offer("要不要我解读一下 GDP 走势，或者对比几个经济体？", "解读这条GDP走势", "对比中国和美国的GDP", "看经济规模排行"),
  trade: () => offer("要不要我解读出口规模和开放度的变化？", "解读出口规模变化", "看开放度气泡图", "看出口占GDP比重"),
  outlook: () => offer("要不要我解读世界银行对未来几年的增长预测？", "解读增长预测路径", "看预测增速排行", "看经济体对照"),
};

export function viewFollowUp(context: ViewContext) {
  if (context.view.startsWith("custom-")) {
    return offer("要不要我用这个专题的数据帮你做一张带文字解读的图？", "帮我做一张带解读的趋势图", "换成科研配色", "介绍一下自定义制图");
  }
  return views[context.view]?.(context);
}

export type TurnOutcome = {
  route: string;
  view?: SiteViewId;
  section?: string;
  filters?: SiteNavigation["filters"];
  hasChart?: boolean;
  hasDashboard?: boolean;
  forecast?: boolean;
  evidence?: number;
  queryShape?: string;
};

/** Default next step for a turn when the model did not offer one. */
export function defaultFollowUp(outcome: TurnOutcome): FollowUp | undefined {
  switch (outcome.route) {
    case "data":
      return outcome.queryShape === "category"
        ? offer("要不要我把各省排名画成柱状图，再帮你解读差异？", "画成柱状图", "解读这组数据", "导出为CSV")
        : outcome.queryShape === "scalar"
          ? offer("要不要我把前后几个月的数据也查出来，看看变化趋势？", "查最近一年的走势", "解释这个指标的口径", "导出为CSV")
          : offer("要不要我把这组数据画成图，再解读走势？", "画成折线图", "解读这组数据", "预测未来6期");
    case "visualization":
      return outcome.hasDashboard
        ? offer("要不要我解读看板里的关键指标？", "解读看板要点", "导出看板数据", "换成柱状图")
        : offer("要不要我解读一下这张图的要点？", "解读这张图", "换成柱状图", "导出图表数据");
    case "analysis":
      return outcome.forecast
        ? offer("预测完成后，要不要我解释预测结果和误差？", "查看分析进度", "解释预测方法", "和基线模型对比")
        : offer("要不要我在任务完成后解读分析结果？", "查看分析进度", "解释分析方法");
    case "knowledge":
      return outcome.evidence
        ? offer("要不要我打开第1条证据的原文核对一下？", "打开第1条证据原文", "用一句话总结要点")
        : undefined;
    case "explanation":
      return offer("要不要我结合本站的数据，看看它在实际中的表现？", "结合本站数据看实际情况", "再讲一个相关原理");
    case "export":
      return offer("还需要我把当前视图保存到项目里吗？", "把当前视图保存为我的视图", "画成图表");
    case "project":
      return offer("要不要我恢复其中一个视图？", "列出项目里的视图", "介绍一下网站的功能");
    case "sources":
      return offer("要不要我解释一下这份数据的口径和局限？", "解释数据口径", "导出为CSV");
    case "navigation":
    case "general":
      return outcome.view ? viewFollowUp({ ...outcome, view: outcome.view }) ?? discovery() : discovery();
    default:
      return undefined;
  }
}

function discovery() {
  return offer("你不确定从哪开始的话，要不要我介绍一下网站能做什么？", "介绍一下网站的功能", "看全国发电量走势", "打开电源地球");
}

export const capabilityQuestion = /^(?:小云[，,]?)?(?:你好[，,]?)?(?:请)?(?:你|小云|这个网站|网站|这里|这个平台|平台)?(?:都|还)?(?:能|可以|会)(?:帮我)?(?:做|干|提供|看)?(?:些)?(?:什么|啥|哪些)(?:功能|事情|事|内容|东西)?[？?。!！]*$|(?:有|提供)(?:什么|哪些|啥)功能|怎么(?:用|使用)(?:这个网站|网站|你)?|使用(?:说明|指南)|^(?:帮助|help|功能介绍|新手引导)$|介绍(?:一下)?(?:网站|平台|你自己|你|功能|网站的功能)/i;

/** Deterministic tour of what the site offers, tailored to the page the user is on. */
export function capabilityTour(view: SiteViewId | undefined) {
  const current = view && siteViewCatalog().find(item => item.view === view);
  const topics = analysisTopicOrder.map(id => analysisTopics[id].label).join("、");
  const markdown = [
    "**我能帮你做这些事**",
    "- **打开视图**：电源、气象、碳排放、经济四个地球，以及" + topics + "等专题分析，还有区域 3D 云雨回放。直接说「我想看 2024 年的发电量」就行。",
    "- **在地图上操作**：定位到省份或国家，切换装机、发电统计，开关图层。",
    "- **查具体数值**：电力、气象、碳排放的数据库问数，结果带数据版本和来源。",
    "- **画图和看板**：把查到的数据画成折线、柱状图，生成数据大屏，或做带文字解读的科研配色图。",
    "- **分析和预测**：描述统计、聚类、预测未来几期、回测和模型对比。",
    "- **查资料**：从审核过的资料里找依据，给出原文段落和出处。",
    "- **讲原理**：用可旋转的立体示意讲清楚机制，比如风机怎么发电。",
    "- **保存和导出**：把当前视图存进项目，或把数据导出成 CSV/JSON。",
  ].join("\n");
  const here = current ? `你现在在「${current.title}」。` : "";
  const base = view && viewFollowUp({ view });
  const others = base?.suggestions.filter(item => item !== discovery().accept) ?? [];
  return {
    summary: `我是小云，能帮你打开视图、查数、画图、做预测和查资料。${here}`,
    markdown,
    followUp: base && others.length === base.suggestions.length ? base
      : offer("要不要我先带你看看全国发电量的走势？", "看全国发电量走势", ...others, "看全球电力碳排放走势"),
  };
}
