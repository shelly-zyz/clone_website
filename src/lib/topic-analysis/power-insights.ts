import { dataStory, difference, reading, unexpectedValue, type Finding } from "./data-story";
import { powerRecords, powerYearRecord, type PowerChartId } from "./power";

type Year = ReturnType<typeof powerYearRecord>;
type Part = Year["parts"][number];
const percentage = (a: number, b: number) => b > 0 ? reading(a / b * 100, "%") : "暂无";
const annualCoverage = "全国；来源为所列年度统计公报。两份公报之间的差值按各年发布值计算。";
const ranked = (parts: Part[], key: "capacity" | "generation" | "change") =>
  parts.filter(part => part[key] !== null).toSorted((a, b) => (b[key] ?? 0) - (a[key] ?? 0));

function compared(value: number, prior: number | null | undefined, year: string | undefined, unit: string) {
  if (prior === null || prior === undefined || !year) return "；没有可比上一年度值。";
  const change = value - prior;
  return `，较 ${year} 年${difference(change, unit)}${prior > 0 && Math.abs(change) >= 0.005 ? `（${percentage(Math.abs(change), prior)}）` : ""}。`;
}

export function powerStory(id: PowerChartId, year: string, source?: string) {
  const row = powerYearRecord(year);
  const history = powerRecords.filter(item => item.year < row.year);
  const previous = history.at(-1);
  const selected = row.parts.find(part => part.id === source);
  const priorPart = previous?.parts.find(part => part.id === selected?.id);
  const [wind, solar] = row.parts.slice(3, 5);
  const combined = wind.share + solar.share;
  const priorCombined = previous && previous.parts[3].share + previous.parts[4].share;
  const leading = ranked(row.parts, "capacity")[0];
  const netGrowth = ranked(row.parts, "change").filter(part => (part.change ?? 0) > 0);
  const driver = netGrowth[0];
  const driverFact = driver ? `${driver.name}增加 ${reading(driver.change!, "GW")}，为增量最大的分项。` : "缺少可比基期，无法识别最大增量分项。";
  const shareFact = `风电与太阳能合计占 ${reading(combined, "%")}${priorCombined === undefined ? "。" : `，较上年${difference(combined - priorCombined, "个百分点")}。`}`;
  const highlights: Finding[] = [];
  const capacityHeadline = `${row.year} 年末${selected ? selected.name : "全国"}装机为 ${reading(selected?.capacity ?? row.capacity, "GW")}` +
    compared(selected?.capacity ?? row.capacity, selected ? priorPart?.capacity : previous?.capacity, previous?.year, "GW");

  if (id === "capacity-comparison") {
    const first = history[0];
    const firstPart = first?.parts.find(part => part.id === selected?.id);
    const change = selected ? selected.change : row.change;
    const priorChange = selected ? priorPart?.change : previous?.change;
    const pace = change !== null && priorChange !== null && priorChange !== undefined
      ? `本年净增量比上一年度${difference(change - priorChange, "GW")}。` : "至少需要三个连续年末观测才能判断扩张速度变化。";
    const range = first ? `自 ${first.year} 年末到 ${row.year} 年末，${selected?.name ?? "全国"}装机${difference((selected?.capacity ?? row.capacity) - (firstPart?.capacity ?? first.capacity), "GW")}。` : "当前年份是年度序列起点。";
    if (driver) highlights.push({ label: "主要增长来源", text: driverFact });
    highlights.push({ label: "趋势特征", text: pace });
    return dataStory(capacityHeadline, `${range}${pace}`, `${shareFact}装机容量是年末存量，不能据此直接判断全年发电效率。`,
      `${annualCoverage}曲带之间的空间间距用于区分电源。`, highlights);
  }

  if (id === "capacity-mix") {
    const part = selected ?? leading;
    const prior = previous?.parts.find(item => item.id === part.id);
    const lead = `${row.year} 年末${part.name}装机为 ${reading(part.capacity, "GW")}，占全国 ${reading(part.share, "%")}${part.id === leading.id ? "，份额最大" : ""}。`;
    const change = prior ? `${part.name}的装机份额较 ${previous?.year} 年${difference(part.share - prior.share, "个百分点")}。` : "缺少上一年度可比份额。";
    return dataStory(lead, `${shareFact}${change}`, `同年风电占 ${reading(wind.share, "%")}、太阳能占 ${reading(solar.share, "%")}。占比反映装机结构，发电结构另以规上工业发电量衡量。`,
      `${annualCoverage}分母为全国年末总装机，其他项保留统计口径及舍入差额。`, [{ label: "结构变化", text: shareFact }]);
  }

  if (id === "capacity-waterfall") {
    const headline = row.change === null ? `${row.year} 年缺少上一年度数据，无法计算年末净增量。`
      : `${row.year} 年末全国装机较 ${previous?.year} 年末${difference(row.change, "GW")}（${percentage(row.change, previous?.capacity ?? 0)}）。`;
    const detail = selected && selected.change !== null
      ? `${selected.name}装机${difference(selected.change, "GW")}${row.change && row.change > 0 ? `，相当于全国净增量的 ${percentage(selected.change, row.change)}` : ""}。`
      : driverFact;
    const pastChanges = history.flatMap(item => item.change === null ? [] : [item.change]);
    const alert = row.change === null ? undefined : unexpectedValue(row.change, pastChanges);
    const anomaly = alert ? `年度净增量${alert.direction}历史参考范围 ${reading(alert.lower)}–${reading(alert.upper, "GW")}。` : "";
    if (driver) highlights.push({ label: selected ? "所选电源" : "主要增长来源", text: detail });
    if (anomaly) highlights.push({ label: "偏离历史参考范围", text: anomaly });
    const both = wind.change === null || solar.change === null ? "缺少风光同口径增量。"
      : `风电与太阳能合计净变化 ${reading(wind.change + solar.change, "GW")}。贡献描述的是装机净变化的分项构成。`;
    return dataStory(headline, `${detail}${selected && driver && selected.name !== driver.name ? driverFact : ""}${anomaly}`, both,
      `${annualCoverage}减少项抵扣增加量。${pastChanges.length < 4 ? "历史可比净增量少于四期，未判断异常。" : "历史范围按前期净增量的 1.5 倍四分位距估计，供进一步核查。"}`, highlights);
  }

  if (id === "renewable-capacity-share") {
    const gap = solar.share - wind.share;
    const gapText = Math.abs(gap) < 0.005 ? "两者份额基本相同。" : `${gap > 0 ? "太阳能" : "风电"}装机份额高 ${reading(Math.abs(gap), "个百分点")}。`;
    const leads = `${row.year} 年末风电占 ${reading(wind.share, "%")}、太阳能占 ${reading(solar.share, "%")}。${gapText}`;
    const selectedChange = selected && priorPart && (selected.id === wind.id || selected.id === solar.id)
      ? `${selected.name}份额较上年${difference(selected.share - priorPart.share, "个百分点")}。` : "";
    return dataStory(leads, `${shareFact}${selectedChange}`, "占比随分项装机与全国总装机共同变化。份额的变化不能用来推断发电量的同比变化。",
      `${annualCoverage}份额按年末容量除以该年全国年末总容量；差值以百分点计。`, [{ label: "结构变化", text: selectedChange || shareFact }]);
  }

  const ranks = ranked(row.parts, "generation");
  const part = selected ?? ranks[0];
  const priorGeneration = previous?.parts.find(item => item.id === part.id)?.generation;
  const lead = part.generation === null ? `${row.year} 年公报未单列${part.name}的规上工业发电量。`
    : `${row.year} 年${part.name}发电量为 ${reading(part.generation, "TWh")}` + compared(part.generation, priorGeneration, previous?.year, "TWh");
  const order = `在已单列的 ${ranks.length} 类电源中，${ranks.slice(0, 2).map(item => `${item.name} ${reading(item.generation!, "TWh")}`).join("、")}排在前面。`;
  const generationRank = ranks.indexOf(part) + 1;
  const capacityRank = ranked(row.parts.slice(0, 5), "capacity").indexOf(part) + 1;
  return dataStory(lead, `${order}${row.generation === null ? "" : `全国规上工业发电量为 ${reading(row.generation, "TWh")}。`}`,
    generationRank && capacityRank ? `${part.name}在已单列的发电量中列第 ${generationRank}，在五类电源年末装机中列第 ${capacityRank}。覆盖范围和时间口径不同，名次只能并列观察。`
      : "所选分项缺少发电量或装机名次，无法进行同类排名对照。",
    `${annualCoverage}未单列的发电量保留为空。发电量是全年流量，装机是年末存量，不能用两者估算利用小时。`,
    [{ label: "已报告的领先电源", text: order }]);
}
