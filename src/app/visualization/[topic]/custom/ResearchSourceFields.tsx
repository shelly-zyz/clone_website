"use client";

import { Trash2 } from "lucide-react";
import { powerProducts, type DataQuery } from "@/lib/data-agent/contracts";
import { economyMetrics, type DatasetRequest } from "@/lib/visualization-agent/research/contracts";
import { economyNames, newSource, productNames, sourceType, sourceTypes } from "./research-controls";
import styles from "./research.module.css";

type Metric = { metric_code: string; name: string; series_codes?: string[] };
export type ResearchCatalog = {
  sources: { published: { topic: DataQuery["topic"]; metrics: Metric[] }[]; power_regions: { code: string; name: string | null }[];
    published_available: boolean; approved_catalog: boolean; global_grid: { fields: string[]; cache: string } };
  engines: { id: string; available: boolean }[];
};

const gridNames = { temperature: "温度", wind: "风速", relativeHumidity: "相对湿度", cape: "对流有效位能", mslp: "海平面气压", precipitableWater: "可降水量" } as const;
const bare = (text: string) => text.trim() || undefined;

export function ResearchSourceFields({ data, index, catalog, onChange, onRemove }: {
  data: DatasetRequest; index: number; catalog?: ResearchCatalog; onChange: (data: DatasetRequest) => void; onRemove?: () => void;
}) {
  let fields;
  if (data.kind === "published") {
    const query = data.query;
    const update = (next: DataQuery) => onChange({ kind: "published", query: next });
    const metrics = catalog?.sources.published.find(entry => entry.topic === query.topic)?.metrics ?? [];
    const current = metrics.find(metric => metric.metric_code === query.metric_code);
    const metricsWithCurrent = query.metric_code && !current
      ? [{ metric_code: query.metric_code, name: query.metric_code }, ...metrics] : metrics;
    const productValues = current?.series_codes?.filter(code => powerProducts.some(value => value === code)) ?? powerProducts;
    const regions = catalog?.sources.power_regions ?? [];
    fields = <>
      <label>指标
        <select value={query.metric_code ?? ""} onChange={event => {
          const metric_code = bare(event.target.value);
          if (query.topic === "power") {
            const products = metrics.find(metric => metric.metric_code === metric_code)?.series_codes;
            update({ ...query, metric_code, product: products?.includes(query.product ?? "") ? query.product : undefined });
          } else update({ ...query, metric_code });
        }}>
          <option value="">该来源默认指标</option>
          {metricsWithCurrent.map(metric => <option key={metric.metric_code} value={metric.metric_code}>{metric.name}</option>)}
        </select>
      </label>
      {query.topic === "power" && <>
        <label>产品
          <select value={query.product ?? ""} onChange={event => update({ ...query, product: bare(event.target.value) as typeof query.product })}>
            <option value="">该指标默认产品</option>
            {productValues.map(code => <option key={code} value={code}>{productNames[code] ?? code}</option>)}
          </select>
        </label>
        <label>地区编码
          <input aria-label="地区编码" inputMode="numeric" pattern="[0-9]{12}" maxLength={12} list={"regions-" + index}
            value={query.region_code} onChange={event => update({ ...query, region_code: event.target.value, province_comparison: undefined })} />
          <datalist id={"regions-" + index}>
            <option value="000000000000">中国全国</option>
            {regions.filter(region => region.code !== "000000000000").map(region => <option key={region.code} value={region.code}>{region.name ?? region.code}</option>)}
          </datalist>
        </label>
        <label className={styles.check}><input type="checkbox" checked={query.province_comparison === true}
          onChange={event => update({ ...query, province_comparison: event.target.checked || undefined,
            region_code: event.target.checked ? "000000000000" : query.region_code })} /> 同一月份的各省对比</label>
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
  } else if (data.kind === "economy") {
    fields = <>
      <label>指标<select value={data.metric} onChange={event => onChange({ ...data, metric: event.target.value as typeof data.metric, version: undefined })}>
        {economyMetrics.map(value => <option key={value} value={value}>{economyNames[value]}</option>)}
      </select></label>
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
    fields = <label>网格变量<select value={data.field} onChange={event => onChange({ ...data, field: event.target.value as typeof data.field, version: undefined })}>
      {Object.entries(gridNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>;
  } else if (data.kind === "replay-grid") {
    fields = <>
      <label>回放编号<input required value={data.id} onChange={event => onChange({ ...data, id: event.target.value, version: undefined })} /></label>
      <label>数据字段<select value={data.field} onChange={event => onChange({ ...data, field: event.target.value as typeof data.field, time: undefined })}>
        <option value="rain">降水率</option><option value="satellite">红外亮温</option>
      </select></label>
      <label>时间（UTC）<input value={data.time ?? ""} placeholder="留空则用第一帧"
        onChange={event => onChange({ ...data, time: bare(event.target.value) })} /></label>
      <label className={styles.check}><input type="checkbox" checked={data.archive === true}
        onChange={event => onChange({ ...data, archive: event.target.checked || undefined, version: undefined })} /> 使用已核对的内置归档</label>
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
      <label>来源 {index + 1}
        <select value={sourceType(data)} onChange={event => onChange(newSource(event.target.value))}>
          {sourceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {onRemove && <button type="button" className={styles.iconButton} onClick={onRemove} title={"移除来源 " + (index + 1)}
        aria-label={"移除来源 " + (index + 1)}><Trash2 size={15} /></button>}
    </div>
    {fields}
  </div>;
}
