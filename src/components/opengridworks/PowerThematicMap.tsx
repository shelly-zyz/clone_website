"use client";

import { geoMercator } from "d3-geo";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useWorkspaceResource } from "@/hooks/use-workspace-resource";
import type { ProvincePowerFrame } from "@/lib/china-power-statistics";
import { formatPowerNumber, powerBin, powerClassColor, powerSelectionColors } from "@/lib/power-analysis";
import type { ChinaPowerGeography } from "./power-statistics-geometry";
import styles from "./PowerRegionPanel.module.css";

const width = 940;
const height = 600;
const mercator = geoMercator().center([104, 35]).scale(14).translate([0, 0]);
type Point = [number, number];
type Polygon = Point[][];
type MapShape = { code: string; name: string; path: string; center?: Point };

function buildPaths(geo: ChinaPowerGeography) {
  const inset: Polygon[] = [];
  const main = geo.features.map(item => {
    const { properties, geometry } = item;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const mainland = polygons.filter(([ring]) => properties.name && ring.some(point => point[1] >= 18));
    inset.push(...polygons.filter(polygon => !mainland.includes(polygon)));
    return { code: String(properties.adcode).padEnd(12, "0"), name: properties.name, polygons: mainland, center: properties.centroid ?? properties.center };
  }).filter(item => item.polygons.length);
  function pathProjector(polygons: Polygon[], x: number, y: number, w: number, h: number) {
    const projected = polygons.flatMap(rings => rings[0].map(point => mercator(point)!));
    const min = [Math.min(...projected.map(p => p[0])), Math.min(...projected.map(p => p[1]))];
    const span = [Math.max(...projected.map(p => p[0])) - min[0], Math.max(...projected.map(p => p[1])) - min[1]];
    const scale = Math.min(w / span[0], h / span[1]);
    const left = x + (w - span[0] * scale) / 2;
    const top = y + (h - span[1] * scale) / 2;
    const point = (coords: Point): Point => {
      const [lng, lat] = mercator(coords)!;
      return [left + (lng - min[0]) * scale, top + (lat - min[1]) * scale];
    };
    const path = (shapes: Polygon[]) => shapes.map(rings => rings.map(ring => "M" + ring.map(coords =>
      point(coords).map(value => value.toFixed(1)).join(",")).join("L") + "Z").join("")).join("");
    return { point, path };
  }
  const project = pathProjector(main.flatMap(row => row.polygons), 14, 16, width - 28, height - 34);
  return {
    shapes: main.map(({ code, name, polygons, center }): MapShape => ({
      code, name, path: project.path(polygons), center: center && project.point(center),
    })),
    inset: inset.length ? pathProjector(inset, 829, 473, 93, 95).path(inset) : "",
  };
}

export function PowerThematicMap({ frame, split, selection, bin, onSelect, screenshotRequest, onScreenshotComplete }: {
  frame: ProvincePowerFrame;
  split?: { a: ProvincePowerFrame; b: ProvincePowerFrame };
  selection: readonly string[];
  bin: number | null;
  onSelect: (code: string) => void;
  screenshotRequest: number;
  onScreenshotComplete: (message: string) => void;
}) {
  const geo = useWorkspaceResource<ChinaPowerGeography>("/data/china-power/provinces.geojson");
  const drawing = useMemo(() => geo.data ? buildPaths(geo.data) : undefined, [geo.data]);
  const [divider, setDivider] = useState(50);
  const clipId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const lastExport = useRef(screenshotRequest);
  const report = useRef(onScreenshotComplete);
  useEffect(() => { report.current = onScreenshotComplete; }, [onScreenshotComplete]);

  useEffect(() => {
    if (!drawing || !svg.current || lastExport.current === screenshotRequest) return;
    lastExport.current = screenshotRequest;
    const copy = svg.current.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("width", String(width));
    copy.setAttribute("height", String(height));
    copy.querySelectorAll("[tabindex]").forEach(node => node.removeAttribute("tabindex"));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "opengridworks-power-analysis.svg";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    report.current("已导出电力专题地图 SVG。");
  }, [drawing, screenshotRequest]);

  if (!drawing) return <p className={styles.mapNotice} role="status">{geo.pending ? "正在读取省级边界…" : "省级边界暂不可用"}</p>;

  function regions(data: ProvincePowerFrame, tab: boolean) {
    const rows = new Map(data.regions.map(row => [row.code, row]));
    const signed = data.encoding === "diverging";
    const shapes = drawing!.shapes;
    const ordered = [...shapes.filter(shape => !selection.includes(shape.code)), ...shapes.filter(shape => selection.includes(shape.code))];
    return ordered.map(({ code, name, path, center }) => {
      const row = rows.get(code);
      const value = row?.value ?? null;
      const index = selection.indexOf(code);
      const selected = index >= 0;
      const isMuted = !selected && bin != null && bin !== powerBin(value, data.scaleMax, signed);
      const label = [name, data.period, data.label, value == null ? "暂无数据" : formatPowerNumber(value, data.unit, signed),
        row?.detail].filter(Boolean).join(" · ");
      return (
        <g key={code}>
          <path d={path} fill={powerClassColor(value, data.scaleMax, signed)} fillRule="evenodd"
            opacity={isMuted ? .23 : !selected && selection.length ? .55 : 1}
            className={styles.provincePath} role="button" tabIndex={tab ? 0 : -1} aria-label={label}
            aria-pressed={selected} data-province={code} onClick={() => onSelect(code)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(code); }
            }}>
            <title>{label}</title>
          </path>
          {selected && center && <circle cx={center[0]} cy={center[1]} r="4" fill={powerSelectionColors[index]} pointerEvents="none" />}
        </g>
      );
    });
  }

  const splitX = width * divider / 100;
  return (
    <div className={styles.thematicMap} data-power-flat-ready aria-label={split ? "省级双期地图" : "省级二维专题地图"}>
      <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={"0 0 " + width + " " + height} className={styles.flatSvg} aria-label={frame.label}>
        <title>{[frame.period, frame.label, frame.unit].join(" · ")}</title>
        {split ? <>
          <defs>
            <clipPath id={clipId}><rect width={splitX} height={height} /></clipPath>
            <clipPath id={clipId + "-current"}><rect x={splitX} width={width - splitX} height={height} /></clipPath>
          </defs>
          <g clipPath={"url(#" + clipId + "-current)"}>{regions(split.b, true)}</g>
          <g clipPath={"url(#" + clipId + ")"}>{regions(split.a, false)}</g>
        </> : regions(frame, true)}
        {drawing.inset && <g aria-label="南海诸岛" pointerEvents="none">
          <rect x="820" y="463" width="110" height="124" rx="4" fill="#0e1b2a" />
          <path d={drawing.inset} fill="#57738c" fillRule="evenodd" />
          <text x="875" y="580" textAnchor="middle" fill="#bcd1e1" fontSize="12">南海诸岛</text>
        </g>}
        {split && <g pointerEvents="none">
          <circle cx={splitX} cy={height / 2} r="16" fill="#132b3d" />
          <path d={"M" + (splitX - 3) + ",293l-6,7 6,7M" + (splitX + 3) + ",293l6,7 -6,7"} fill="none" stroke="#dcecf3" strokeWidth="2" />
        </g>}
      </svg>
      {split && <div className={styles.wipe}>
        <label htmlFor={clipId + "-slider"}>{split.a.period}<span>拖动对照</span>{split.b.period}</label>
        <input id={clipId + "-slider"} aria-label="双期地图分割位置" type="range" min="6" max="94" value={divider}
          onChange={event => setDivider(Number(event.currentTarget.value))} />
      </div>}
    </div>
  );
}
