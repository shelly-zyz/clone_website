"use client";

import { Trash2 } from "lucide-react";
import { powerProducts, type DataQuery } from "@/lib/data-agent/contracts";
import { capacitySources, type BusinessDataset, type DatasetRequest } from "@/lib/visualization-agent/research/contracts";
import { productNames } from "./research-controls";
import styles from "./research.module.css";

type Metric = { metric_code: string; name: string; series_codes?: string[] };
export type ResearchCatalog = {
  sources: { published: { topic: DataQuery["topic"]; metrics: Metric[] }[]; power_regions: { code: string; name: string | null }[];
    business_datasets: BusinessDataset[]; published_available: boolean; approved_catalog: boolean; global_grid: { fields: string[]; cache: string } };
  engines: { id: string; available: boolean }[];
};

const bare = (text: string) => text.trim() || undefined;

export function ResearchSourceFields({ data, label, index, catalog, onChange, onRemove }: {
  data: DatasetRequest; label: string; index: number; catalog?: ResearchCatalog; onChange: (data: DatasetRequest) => void; onRemove: () => void;
}) {
  let fields;
  if (data.kind === "published") {
    const query = data.query;
    const update = (next: DataQuery) => onChange({ kind: "published", query: next });
    const metrics = catalog?.sources.published.find(entry => entry.topic === query.topic)?.metrics ?? [];
    const current = metrics.find(metric => metric.metric_code === query.metric_code);
    const productValues = current?.series_codes?.filter(code => powerProducts.some(value => value === code)) ?? powerProducts;
    const regions = catalog?.sources.power_regions ?? [];
    fields = <>
      {query.topic === "power" && <>
        <label>产品
          <select value={query.product ?? ""} onChange={event => update({ ...query, product: bare(event.target.value) as typeof query.product })}>
            <option value="">该指标默认产品</option>
            {productValues.map(code => <option key={code} value={code}>{productNames[code] ?? code}</option>)}
          </select>
        </label>
        <label>地区
          <select value={query.region_code} disabled={query.province_comparison === true}
            onChange={event => update({ ...query, region_code: event.target.value, province_comparison: undefined })}>
            <option value="000000000000">{query.province_comparison ? "同月各省" : "中国全国"}</option>
            {regions.filter(region => region.code !== "000000000000").map(region => <option key={region.code} value={region.code}>{region.name ?? region.code}</option>)}
          </select>
        </label>
      </>}
      <div className={styles.pair}>
        <label>起始日期<input type="date" value={query.start_date ?? ""} onChange={event => update({ ...query, start_date: bare(event.target.value),
          ...(query.topic === "meteo" ? { issue_time: undefined } : {}) })} /></label>
        <label>结束日期<input type="date" value={query.end_date ?? ""} onChange={event => update({ ...query, end_date: bare(event.target.value),
          ...(query.topic === "meteo" ? { issue_time: undefined } : {}) })} /></label>
      </div>
      {query.topic === "meteo" && <label>指定起报（UTC）<input value={query.issue_time ?? ""} placeholder="留空则用最近的起报"
        onChange={event => update({ ...query, issue_time: bare(event.target.value) })} /></label>}
    </>;
  } else if (data.kind === "annual-capacity") {
    fields = <>
      <label>电源<select value={data.source ?? "electricity"} disabled={data.composition_year !== undefined}
        onChange={event => onChange({ ...data, source: event.target.value as typeof data.source })}>
        {capacitySources.map(source => <option key={source} value={source}>{source === "other" ? "其他及口径差额" : productNames[source]}</option>)}
      </select></label>
      <div className={styles.pair}>
        <label>起始年份<input type="number" min={2020} max={2025} value={data.start_year ?? ""}
          onChange={event => onChange({ ...data, start_year: Number(event.target.value) || undefined })} /></label>
        <label>结束年份<input type="number" min={2020} max={2025} value={data.end_year ?? ""}
          onChange={event => onChange({ ...data, end_year: Number(event.target.value) || undefined })} /></label>
      </div>
    </>;
  } else if (data.kind === "economy") {
    fields = <>
      <label>经济体三字代码<input aria-label="经济体三字代码" required value={data.country} maxLength={3} pattern="[A-Z]{3}"
        onChange={event => onChange({ ...data, country: event.target.value.toUpperCase() })} /></label>
      <div className={styles.pair}>
        <label>起始年份<input type="number" min={1960} max={2200} value={data.start_year ?? ""}
          onChange={event => onChange({ ...data, start_year: event.target.value ? Number(event.target.value) : undefined })} /></label>
        <label>结束年份<input type="number" min={1960} max={2200} value={data.end_year ?? ""}
          onChange={event => onChange({ ...data, end_year: event.target.value ? Number(event.target.value) : undefined })} /></label>
      </div>
    </>;
  } else if (data.kind === "gfs-grid") {
    fields = <p className={styles.hint}>使用最新已核验的全球格点帧。</p>;
  } else if (data.kind === "replay-grid") {
    fields = <>
      <label>时间（UTC）<input value={data.time ?? ""} placeholder="留空则用第一帧"
        onChange={event => onChange({ ...data, time: bare(event.target.value) })} /></label>
    </>;
  } else {
    fields = data.kind === "result" ? <label>问数结果 ID<input required value={data.result_id} maxLength={36}
      onChange={event => onChange({ ...data, result_id: event.target.value.trim() })} /></label>
      : data.kind === "forecast-job" ? <label>分析任务 ID<input required value={data.job_id} maxLength={36}
        onChange={event => onChange({ ...data, job_id: event.target.value.trim() })} /></label>
        : <label>归档编号<input required value={data.id} maxLength={51}
          onChange={event => onChange({ ...data, id: event.target.value.trim(), version: undefined })} /></label>;
  }
  return <div className={styles.sourceGroup}>
    <div className={styles.sourceTop}>
      <strong>{label}</strong>
      <button type="button" className={styles.iconButton} onClick={onRemove} aria-label={"移除指标 " + (index + 1)}><Trash2 size={15} /></button>
    </div>
    {fields}
  </div>;
}
