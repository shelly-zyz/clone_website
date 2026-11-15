"use client";

import {
  ArrowDownToLine, ArrowLeft, ArrowUpRight, ChartArea, ChartBar, ChartCandlestick, ChartScatter,
  ChevronDown, FileSpreadsheet, GitBranch, Grid3X3, Network, Palette, PanelsTopLeft, Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { BarChart, BoxplotChart, GraphChart, HeatmapChart, LineChart, ParallelChart, SankeyChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, ParallelComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { init, use as registerCharts, type EChartsType } from "echarts/core";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import {
  availableFields, chartTemplates, fieldName, optionalField, readChartData, recommendCharts, sampleData, uploadLimits,
  type ChartData, type ChartField, type ChartFields, type ChartTemplate,
} from "@/lib/topic-analysis/custom-chart";
import { buildChart, palettes, type PaletteName } from "./chart-options";
import styles from "./studio.module.css";

registerCharts([
  BarChart, BoxplotChart, GraphChart, HeatmapChart, LineChart, ParallelChart, SankeyChart, ScatterChart,
  DataZoomComponent, GridComponent, LegendComponent, ParallelComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer, SVGRenderer,
]);

const templateIcons = {
  heatmap: Grid3X3, trend: ChartArea, scatter: ChartScatter, parallel: PanelsTopLeft,
  boxplot: ChartCandlestick, sankey: GitBranch, graph: Network, rank: ChartBar,
};

function saveFile(href: string, name: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
}

function FieldSelect({ data, kind, field, label, fields, onChange }: {
  data: ChartData; kind: ChartTemplate; field: ChartField; label: string; fields: ChartFields;
  onChange: (field: ChartField, index?: number) => void;
}) {
  const choices = availableFields(data, kind, field, fields);
  const optional = optionalField(kind, field);
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.selectBox}>
        <select value={fields[field] ?? ""} onChange={event => onChange(field, event.target.value ? Number(event.target.value) : undefined)}>
          {optional && <option value="">{field === "group" ? "不分组" : field === "x" ? "按行编号" : kind === "scatter" ? "固定大小" : "记录数"}</option>}
          {choices.map(column => <option key={column.index} value={column.index}>{column.label}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden />
      </span>
    </label>
  );
}

export function CustomChartStudio({ topicName, backHref }: { topicName: string; backHref: string }) {
  const [data, setData] = useState(sampleData);
  const [kind, setKind] = useState<ChartTemplate>("heatmap");
  const [mappings, setMappings] = useState<Partial<Record<ChartTemplate, ChartFields>>>({});
  const [paletteName, setPalette] = useState<PaletteName>("lagoon");
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const chartElement = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const uploadId = useId();
  const recommendations = useMemo(() => recommendCharts(data), [data]);
  const selected = recommendations.find(item => item.kind === kind) ?? recommendations[0];
  const selectedKind = selected?.kind;
  const fields = selected && (mappings[selected.kind] ?? selected.fields);
  const result = useMemo(() => selectedKind && fields ? buildChart(data, selectedKind, fields, paletteName, compact) : null,
    [data, selectedKind, fields, paletteName, compact]);
  const template = selected && chartTemplates[selected.kind];
  const title = (() => {
    if (!selected || !fields) return "图表预览";
    const metric = fieldName(data, fields.value);
    switch (selected.kind) {
      case "heatmap": return `${metric}分布`;
      case "trend": return `${metric}趋势`;
      case "scatter": return `${fieldName(data, fields.x)}与${fieldName(data, fields.y)}`;
      case "boxplot": return `${metric}分布对比`;
      case "rank": return `${metric || "记录数"}排名`;
      case "sankey": return metric ? `${metric}流向` : "记录流向";
      case "graph": return "节点关系";
      case "parallel": return "多指标对比";
    }
  })();

  const hasChart = Boolean(result?.option);

  useEffect(() => {
    const element = chartElement.current;
    if (!element || !hasChart) return;
    const instance = init(element, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => {
      setCompact(element.clientWidth < 550);
      instance.resize();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [hasChart]);

  useEffect(() => {
    if (result?.option) chart.current?.setOption(result.option, { notMerge: true });
  }, [result]);

  function selectDataset(next: ChartData) {
    const initial = recommendCharts(next)[0];
    if (!initial) throw new Error("没有找到可以制图的字段。");
    setData(next);
    setKind(initial.kind);
    setMappings({});
    setExportError("");
  }

  async function upload(file: File) {
    const ticket = ++request.current;
    setError("");
    setExportError("");
    setLoading(true);
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("请选择 .csv 文件。");
      if (file.size > uploadLimits.bytes) throw new Error("CSV 文件不能超过 2 MB。");
      const buffer = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        throw new Error("请将 CSV 另存为 UTF-8 编码后再上传。");
      }
      const dataset = readChartData(file.name, text);
      if (ticket === request.current) selectDataset(dataset);
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause.message : "读取 CSV 失败。");
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const [file] = event.dataTransfer.files;
    if (file) void upload(file);
  }

  function changeField(field: ChartField, index?: number) {
    if (!selected || !fields) return;
    const next = { ...fields, [field]: index };
    if (selected.kind === "trend" && next.group === next.x) delete next.group;
    setMappings(previous => ({ ...previous, [selected.kind]: next }));
  }

  function exportChart(extension: "png" | "svg") {
    if (!chart.current || !result?.option) return;
    const filename = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 95) + "." + extension;
    setExportError("");
    try {
      if (extension === "png") {
        saveFile(chart.current.getDataURL({ type: "png", pixelRatio: 2 }), filename);
        return;
      }
      const exportPlot = init(null, undefined, {
        renderer: "svg", ssr: true, width: chart.current.getWidth(), height: chart.current.getHeight(),
      });
      try {
        exportPlot.setOption(result.option);
        const url = URL.createObjectURL(new Blob([exportPlot.renderToSVGString()], { type: "image/svg+xml;charset=utf-8" }));
        saveFile(url, filename);
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } finally {
        exportPlot.dispose();
      }
    } catch {
      setExportError("图表下载失败，请重试。");
    }
  }

  return (
    <section className={styles.studio} aria-labelledby="studio-title">
      <div className={styles.heading}>
        <div>
          <Link href={backHref} className={styles.back}><ArrowLeft size={15} aria-hidden />{topicName}</Link>
          <h1 id="studio-title">自定义制图</h1>
          <p>上传 CSV，用自己的数据试用适合的图表。</p>
        </div>
        {data !== sampleData && <button className={styles.secondaryButton} type="button" onClick={() => {
          request.current++;
          setLoading(false);
          setError("");
          selectDataset(sampleData);
        }}>查看示例数据 <ArrowUpRight size={15} aria-hidden /></button>}
      </div>

      <div className={styles.upload} data-dragging={dragging} onDragOver={event => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }} onDragLeave={event => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      }} onDrop={dropFile}>
        <div className={styles.fileIcon}><FileSpreadsheet size={24} aria-hidden /></div>
        <div className={styles.fileDetails}>
          <strong>{data.name}</strong>
          <p>{data.rows.length.toLocaleString("zh-CN")} 行 · {data.columns.length} 列 · {data === sampleData ? "示例数据" : "用户上传"}</p>
        </div>
        <button className={styles.uploadButton} type="button" onClick={() => fileInput.current?.click()}>
          <Upload size={17} aria-hidden />{loading ? "正在读取…" : "上传 CSV"}
        </button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" aria-label="上传 CSV 文件" aria-describedby={uploadId}
          className={styles.fileInput} tabIndex={-1} onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }} />
      </div>
      <p className={styles.uploadHint} id={uploadId}>支持拖放 · UTF-8 CSV · 最多 2 MB、5,000 行 · 文件在当前浏览器内处理</p>
      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.workspace}>
        <section className={styles.templates} aria-labelledby="templates-title">
          <h2 id="templates-title">适合这份数据的图表</h2>
          <div className={styles.templateList}>
            {recommendations.map(({ kind: format }) => {
              const preset = chartTemplates[format];
              const Icon = templateIcons[format];
              return (
                <button key={format} type="button" className={styles.template} data-kind={format} aria-pressed={selectedKind === format}
                  onClick={() => { setKind(format); setExportError(""); }}>
                  <span className={styles.templateIcon}><Icon size={21} strokeWidth={1.8} aria-hidden /></span>
                  <span className={styles.templateDescription}><strong>{preset.name}</strong><span>{preset.description}</span></span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.output} aria-labelledby="preview-title" data-palette={paletteName}>
          <div className={styles.outputHeader}>
            <div>
              <h2 id="preview-title">{title}</h2>
              <p>{template?.name} · {data === sampleData ? "示例数据" : "用户上传"}</p>
            </div>
            <div className={styles.export}>
              <button type="button" onClick={() => exportChart("png")} disabled={!hasChart} aria-label="下载 PNG">
                <ArrowDownToLine size={14} aria-hidden />PNG
              </button>
              <button type="button" onClick={() => exportChart("svg")} disabled={!hasChart} aria-label="下载 SVG">
                <ArrowDownToLine size={14} aria-hidden />SVG
              </button>
            </div>
          </div>
          {exportError && <p className={styles.error} role="alert">{exportError}</p>}
          {result?.error ? <p className={styles.chartError} role="status">{result.error}</p>
            : <div className={styles.plot} ref={chartElement} role="img" aria-label={`${title}，${template?.name ?? "图表"}`} />}
          {result?.note && <p className={styles.note}>{result.note}</p>}
          {selected && fields && template && <div className={styles.controls}>
            <div className={styles.fieldGroup} role="group" aria-label="图表字段">
              {(Object.entries(template.fields) as [ChartField, string][]).map(([field, label]) => (
                <FieldSelect key={field} data={data} kind={selected.kind} field={field} label={label} fields={fields} onChange={changeField} />
              ))}
            </div>
            <div className={styles.palette} role="group" aria-label="配色">
              <Palette size={17} aria-hidden />
              {(Object.keys(palettes) as PaletteName[]).map(key => (
                <button type="button" key={key} data-swatch={key} aria-pressed={paletteName === key} onClick={() => setPalette(key)}>
                  <span aria-hidden />{palettes[key].name}
                </button>
              ))}
            </div>
          </div>}
        </section>
      </div>
      <details className={styles.dataPreview}>
        <summary>预览数据 <ChevronDown size={16} aria-hidden /></summary>
        <div className={styles.tableWrap}>
          <table aria-label="上传数据的前六行">
            <thead><tr>{data.columns.map(column => <th key={column.index} scope="col">{column.label}</th>)}</tr></thead>
            <tbody>{data.rows.slice(0, 6).map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
