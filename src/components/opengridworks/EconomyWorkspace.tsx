"use client";

import { ArrowUpRight } from "lucide-react";
import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";
import { ForecastSeries, ForecastSidebar } from "./ForecastSidebar";
import { WorkspaceFilterSelect, WorkspaceSidebar } from "./WorkspaceSidebar";
import styles from "./EconomyWorkspace.module.css";
import forecastStyles from "./ForecastSidebar.module.css";

const indicators = {
  "NY.GDP.MKTP.CD": { label: "GDP", min: 1e8, max: 3e13, unit: "美元" },
  "NY.GDP.PCAP.CD": { label: "人均 GDP", min: 5e2, max: 1e5, unit: "美元/人" },
  "NE.EXP.GNFS.CD": { label: "商品与服务出口额", min: 1e7, max: 4e12, unit: "美元" },
};

type Indicator = keyof typeof indicators;

type Country = {
  code: string;
  mapId: string;
  label: string;
  coordinates: [number, number];
  values: Record<Indicator, (number | null)[]>;
};

type EconomySnapshot = {
  years: number[];
  updateDates: Record<Indicator, string>;
  countries: Country[];
};

type CountryValue = { country: Country; value: number | null };
type EconomicOutlook = {
  edition: string;
  sourceUrl: string;
  years: number[];
  values: Record<string, (number | null)[] | undefined>;
};

const globeCenter: [number, number] = [79, 22];
const formatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });
const perCapitaFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function formatAmount(value: number, indicator: Indicator) {
  const number = indicator === "NY.GDP.PCAP.CD" ? perCapitaFormatter.format(value) : formatter.format(value);
  return `${number} ${indicators[indicator].unit}`;
}

function globeZoom(container: HTMLElement) {
  const diameter = Math.max(185, Math.min(container.clientWidth, container.clientHeight) * 0.87);
  return Math.log2(diameter / 145);
}

function mapLayers(values: CountryValue[], indicator: Indicator) {
  const { min, max } = indicators[indicator];
  const levels = new Map<string, number>();
  const points: FeatureCollection<Point, { mapId: string; level: number }> = { type: "FeatureCollection", features: [] };

  for (const { country, value } of values) {
    if (value === null) continue;
    const level = Math.min(1, Math.log(Math.max(value, min) / min) / Math.log(max / min));
    levels.set(country.mapId, level);
    points.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: country.coordinates },
      properties: { mapId: country.mapId, level },
    });
  }

  const [first, ...rest] = levels;
  const levelByCountry: ExpressionSpecification = first
    ? ["match", ["get", "ADM0_A3"], first[0], first[1], ...rest.flat(), -1]
    : ["literal", -1];
  const fill: ExpressionSpecification = ["interpolate", ["linear"], levelByCountry,
    -1, "#25262a", 0, "#302822", 0.5, "#67422e", 1, "#c88443"];
  return { fill, points };
}

function EconomyGlobe({ values, indicator, selected, onSelect }: {
  values: CountryValue[];
  indicator: Indicator;
  selected: Country | undefined;
  onSelect: (mapId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    let view: MapLibreMap;
    try {
      view = new maplibregl.Map({
        container: element,
        center: globeCenter,
        zoom: globeZoom(element),
        minZoom: 0.1,
        maxZoom: 6,
        dragRotate: false,
        touchPitch: false,
        attributionControl: false,
        style: {
          version: 8,
          projection: { type: "globe" },
          sources: {
            countries: { type: "geojson", data: "/data/natural-earth/ne_50m_admin_0_countries.geojson" },
            indicators: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "oceans", type: "background", paint: { "background-color": "#17191d" } },
            { id: "countries", type: "fill", source: "countries", paint: { "fill-color": "#25262a" } },
            { id: "borders", type: "line", source: "countries", paint: { "line-color": "#8e735b", "line-opacity": 0.38, "line-width": 0.7 } },
            { id: "selected-country", type: "line", source: "countries", filter: ["==", ["get", "ADM0_A3"], ""],
              paint: { "line-color": "#ffdb96", "line-width": 2, "line-opacity": 0.96 } },
            { id: "indicator-glow", type: "circle", source: "indicators", paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "level"], 0, 4, 1, 18],
              "circle-color": "#efaa64", "circle-opacity": 0.52, "circle-blur": 0.9,
            } },
            { id: "indicator-points", type: "circle", source: "indicators", paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "level"], 0, 1.3, 1, 5.8],
              "circle-color": ["interpolate", ["linear"], ["get", "level"], 0, "#b98150", 1, "#ffe9b2"],
              "circle-opacity": 0.96, "circle-blur": 0.18,
            } },
          ],
        },
      });
    } catch {
      const request = requestAnimationFrame(() => setStatus("unavailable"));
      return () => cancelAnimationFrame(request);
    }

    map.current = view;
    view.once("load", () => setStatus("ready"));
    return () => {
      map.current = null;
      view.remove();
    };
  }, []);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready") return;
    const { fill, points } = mapLayers(values, indicator);
    view.setPaintProperty("countries", "fill-color", fill);
    view.getSource<maplibregl.GeoJSONSource>("indicators")?.setData(points);

    const mapIds = new Set(values.map(({ country }) => country.mapId));
    const pickCountry = (event: maplibregl.MapMouseEvent) => {
      const features = view.queryRenderedFeatures(event.point, { layers: ["indicator-points", "countries"] });
      for (const { properties } of features) {
        const mapId: unknown = properties.mapId ?? properties.ADM0_A3;
        if (typeof mapId === "string" && mapIds.has(mapId)) {
          onSelect(mapId);
          return;
        }
      }
    };
    view.on("click", pickCountry);
    return () => { view.off("click", pickCountry); };
  }, [indicator, onSelect, status, values]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready") return;
    const zoom = globeZoom(view.getContainer());
    view.setFilter("selected-country", ["==", ["get", "ADM0_A3"], selected?.mapId ?? ""]);
    view.easeTo({ center: selected?.coordinates ?? globeCenter, zoom: zoom + (selected ? 0.55 : 0), duration: 680 });
  }, [selected, status]);

  return (
    <section className={styles.viewport} aria-label="交互式经济地球">
      <div className={styles.map} ref={container} />
      {status === "unavailable" ? <p className={styles.mapStatus} role="status">当前浏览器无法绘制地球</p> : null}
    </section>
  );
}

export function EconomyWorkspace() {
  const [snapshot, setSnapshot] = useState<EconomySnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [indicator, setIndicator] = useState<Indicator>("NY.GDP.MKTP.CD");
  const [year, setYear] = useState(2024);
  const [countryId, setCountryId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/data/economy/wdi.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("World Bank snapshot is unavailable");
        return response.json() as Promise<EconomySnapshot>;
      })
      .then((data) => { if (!controller.signal.aborted) setSnapshot(data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  const countryOptions = useMemo(() => {
    const options = snapshot?.countries.map(({ mapId, label }) => ({ value: mapId, label })) ?? [];
    return [{ value: "", label: "全球" }, ...options.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))];
  }, [snapshot]);
  const yearOptions = snapshot?.years.toReversed().map((value) => ({ value: String(value), label: `${value} 年` }))
    ?? [{ value: String(year), label: `${year} 年` }];
  const values = useMemo(() => {
    if (!snapshot) return [];
    const index = snapshot.years.indexOf(year);
    return snapshot.countries.map((country) => ({ country, value: country.values[indicator][index] ?? null }));
  }, [snapshot, indicator, year]);
  const selected = values.find(({ country }) => country.mapId === countryId);
  const available = values.filter(({ value }) => value !== null).length;
  const { min, max } = indicators[indicator];

  return (
    <>
      <EconomyGlobe values={values} indicator={indicator} selected={selected?.country} onSelect={setCountryId} />
      <WorkspaceSidebar topic="economy" summary="世界银行 WDI · 全球经济指标">
        <section className={styles.filters} aria-label="经济数据筛选">
          <WorkspaceFilterSelect label="国家或地区" options={countryOptions} value={countryId} onChange={setCountryId} />
          <WorkspaceFilterSelect label="经济指标" value={indicator}
            options={Object.entries(indicators).map(([value, { label }]) => ({ value, label }))}
            onChange={(value) => setIndicator(value as Indicator)} />
          <WorkspaceFilterSelect label="统计年份" options={yearOptions} value={String(year)} onChange={(value) => setYear(Number(value))} />
          <div className={styles.value} role="status">
            {selected ? (
              <>
                <span>{selected.country.label} · {year} 年</span>
                <strong>{selected.value === null ? "暂无该年数据" : formatAmount(selected.value, indicator)}</strong>
              </>
            ) : snapshot ? <span>{year} 年 · {available} 个国家或地区有数据</span>
              : <span>{failed ? "经济数据暂不可用" : "正在加载经济数据…"}</span>}
          </div>
          <div className={styles.legend} aria-label="经济指标图例">
            <p>现价美元 · 对数色阶</p>
            <div className={styles.scale} aria-hidden="true" />
            <div className={styles.range}><span>≤ {formatAmount(min, indicator)}</span><span>≥ {formatAmount(max, indicator)}</span></div>
            <p className={styles.missing}><span aria-hidden="true" /> 缺测</p>
          </div>
          <div className={styles.source}>
            <a href={`https://data.worldbank.org/indicator/${indicator}`} target="_blank" rel="noreferrer">
              世界银行 · WDI 指标说明 <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            {snapshot ? <span>上游更新 {snapshot.updateDates[indicator]}</span> : null}
          </div>
        </section>
      </WorkspaceSidebar>
      <EconomyForecast country={selected?.country} />
    </>
  );
}

function EconomyForecast({ country }: { country?: Country }) {
  const [outlook, setOutlook] = useState<EconomicOutlook | null>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/data/economy/gep.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Economic outlook is unavailable");
        return response.json() as Promise<EconomicOutlook>;
      })
      .then((data) => { if (!controller.signal.aborted) setOutlook(data); })
      .catch(() => { if (!controller.signal.aborted) setOutlook(null); });
    return () => controller.abort();
  }, []);

  const values = outlook?.values[country?.code ?? "WLT"];
  const points = outlook && values
    ? outlook.years.map((year, index) => ({ date: `${year}-01-01`, value: values[index] ?? null }))
    : [];
  return (
    <ForecastSidebar topic="economy">
      <h3>{country?.label ?? "全球"}实际 GDP 增速</h3>
      <p className={forecastStyles.muted}>世界银行发布预测 · 按不变价计算</p>
      {points.some(({ value }) => value !== null) ? (
        <ForecastSeries points={points} unit="%" grain="year" label="实际 GDP 年增速预测" />
      ) : (
        <p className={forecastStyles.status} role="status">
          {outlook === undefined ? "正在读取增长展望…" : outlook ? "该地区暂无已发布的增长预测。" : "增长展望暂不可用。"}
        </p>
      )}
      {outlook && (
        <p className={forecastStyles.source}>
          <a href={outlook.sourceUrl} target="_blank" rel="noreferrer">世界银行 · 全球经济展望</a>
          {" · "}{outlook.edition} 版
        </p>
      )}
    </ForecastSidebar>
  );
}
