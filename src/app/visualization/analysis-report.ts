import type { DataStory } from "@/lib/topic-analysis/data-story";
import { formatAnalysisValue, hasChartValues, type AnalysisChartSpec, type Metric } from "@/lib/topic-analysis/model";
import { renderReportChart } from "./AnalysisPlot";

export type ReportFigure = { spec: AnalysisChartSpec; story: DataStory };
export type TopicReport = {
  title: string;
  scope: string;
  metrics: readonly Metric[];
  context: readonly { label: string; value: string }[];
  figures: readonly ReportFigure[];
};

const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const html = (value: string) => value.replace(/[&<>"']/g, character => entities[character]);
const unit = (value: string, suffix?: string) => suffix ? value + " " + suffix : value;

function sourceHref(href: string) {
  try {
    const url = new URL(href);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch { /* Invalid citations still retain their labels. */ }
}

function fallbackTable(spec: AnalysisChartSpec) {
  if (spec.kind === "sankey") {
    return table(["来源", "去向", spec.unit], spec.links.map(link => [link.source, link.target, formatAnalysisValue(link.value)]));
  }
  const grid = spec.kind === "heatmap";
  const names = spec.kind === "bubble" ? [...spec.series.map((entry, i) => unit(entry.name, i ? spec.unit : spec.xUnit)),
    unit(spec.sizeName, spec.sizeUnit)] : spec.series.map(series => unit(series.name, series.unit ?? spec.unit));
  return grid ? table(["分组", ...spec.labels], spec.series.map(entry => [entry.name, ...entry.values.map(formatAnalysisValue)]))
    : table(["分组", ...names], spec.labels.map((label, i) => [label, ...spec.series.map(series => formatAnalysisValue(series.values[i] ?? null)),
      ...(spec.kind === "bubble" ? [formatAnalysisValue(spec.sizes[i] ?? null)] : [])]));
}

function table(headings: string[], rows: string[][]) {
  return "<div class='table'><table><thead><tr>" + headings.map(heading => "<th scope='col'>" + html(heading) + "</th>").join("")
    + "</tr></thead><tbody>" + rows.map(row => "<tr>" + row.map((value, index) =>
      index === 0 ? "<th scope='row'>" + html(value) + "</th>" : "<td>" + html(value) + "</td>").join("") + "</tr>").join("")
    + "</tbody></table></div>";
}

export async function buildTopicReport(report: TopicReport) {
  const figures: string[] = [];
  const citations = [...new Map(report.figures.flatMap(({ spec }) => spec.sources.map(source => [source.href, source] as const))).values()];
  const numbers = new Map(citations.map(({ href }, i) => [href, i + 1]));

  for (const { spec, story } of report.figures) {
    let plot = "";
    if (hasChartValues(spec)) {
      try {
        const svg = await renderReportChart(spec);
        plot = '<img alt="' + html(spec.title) + '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '">';
      } catch {
        plot = "<p>图形暂无法嵌入。以下为本图数值。</p>" + fallbackTable(spec);
      }
    }
    const refs = spec.sources.map(({ href }) => {
      const id = numbers.get(href);
      return '<a href="#source-' + id + '">[' + id + ']</a>';
    }).join(" ");
    const sections = [
      ...story.sections,
      ...story.highlights.slice(1).filter(item => !story.sections.some(section => section.text === item.text)),
    ].map(({ label, text }) => "<div><dt>" + html(label) + "</dt><dd>" + html(text) + "</dd></div>").join("");
    const note = spec.id === "capacity-comparison" ? "报告采用相同数据的二维图，深度信息见在线交互图。" : "";
    figures.push('<section class="figure"><h2>' + html(spec.title) + '</h2><figure>' + plot
      + '<figcaption>' + html(spec.caption + (note ? " " + note : "")) + ' ' + refs + '</figcaption></figure>'
      + '<dl class="story">' + sections + '</dl></section>');
  }

  const information = report.context.map(({ label, value }) => '<div><dt>' + html(label) + '</dt><dd>' + html(value) + '</dd></div>').join("");
  const metrics = report.metrics.map(metric => '<div><dt>' + html(metric.label) + '</dt><dd>' + html(unit(metric.value, metric.unit)) + '</dd></div>').join("");
  const sources = citations.map(({ label, href }, i) => {
    const url = sourceHref(href);
    return '<li id="source-' + (i + 1) + '">' + (url ? '<a href="' + html(url) + '">' + html(label) + '</a><span>' + html(url) + '</span>' : html(label)) + '</li>';
  }).join("");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${html(report.title)} · OpenGridWorks</title>
<style>
:root{color-scheme:light;color:#27384a;background:#eef2f6;font:15px/1.66 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}body{max-width:1050px;margin:24px auto;padding:0 18px}main{padding:clamp(18px,4vw,42px);background:white}
header{border-top:4px solid #5d6193;padding-top:16px;margin-bottom:24px}header>p:first-child{color:#516489;font-weight:700}
h1,h2,p,dl,figure{margin:0}h1{font-size:clamp(23px,4vw,36px);line-height:1.25}h2{font-size:20px;line-height:1.35}
header>p:last-child{margin-top:8px;color:#4f6377}.context,.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:7px 18px;margin-top:12px}.context div{min-width:0}
dl dt{color:#475d77;font-size:.85em;font-weight:680}dl dd{margin:1px 0 0;overflow-wrap:anywhere}.context dd{font-size:.9em}
.metrics div{padding:9px 12px;background:#f0f4fa}.metrics dd{font-size:1.22em;font-weight:700;font-variant-numeric:tabular-nums}
.figure{padding-top:13px;margin-top:22px;border-top:1px solid #d9e3ec}
figure{margin:8px 0}figure img{display:block;width:100%;height:auto}figcaption{color:#52667a;font-size:.86em}
.story{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:7px 15px;background:#f4f6fb;padding:11px 13px;font-size:.92em}
a{color:#395781;text-decoration:underline;text-underline-offset:2px}ol{margin:7px 0 0;padding-left:23px}.sources{margin-top:22px}.sources span{display:block;color:#52667a;font-size:.8em;overflow-wrap:anywhere}
.table{overflow:auto}table{border-collapse:collapse;font-size:.78em}td,th{border:1px solid #d9e3ec;padding:3px 6px;text-align:left}
@page{size:A4;margin:13mm}
@media print{:root{background:#fff;font-size:10.5pt}body,main{margin:0;padding:0}h2{break-after:avoid}figure,.metrics,.story>div{break-inside:avoid}figure img{max-height:157mm;object-fit:contain}.story,.metrics{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main>
<header><p>OpenGridWorks · 专题分析报告</p><h1>${html(report.title)}</h1><p>${html(report.scope)}</p>
<dl class="context">${information}</dl>${metrics ? '<dl class="metrics">' + metrics + '</dl>' : ''}</header>
${figures.length ? figures.join("") : '<p>当前筛选没有可用图表。可用数据状态见报告页首。</p>'}
${sources ? '<section class="sources"><h2>数据来源</h2><ol>' + sources + '</ol></section>' : ''}
</main></body></html>`;
}
