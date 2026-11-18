"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WorkspaceFilterSelect, type WorkspaceFilterOption } from "./WorkspaceSidebar";
import styles from "./VerticalColorLegend.module.css";

function readChoices(document: Document, selector: string) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(`#menu ${selector}`));
  const options: WorkspaceFilterOption[] = elements.map((element) => ({
    value: element.id,
    label: element.title || element.textContent?.trim() || element.id,
    disabled: element.classList.contains("disabled"),
  }));
  return { options, value: elements.find((element) => element.classList.contains("highlighted"))?.id ?? "" };
}

function readWeatherMenu(document: Document) {
  const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
  const mode = readChoices(document, ":is(#wind-mode-enable, #ocean-mode-enable)");
  const isOcean = mode.value === "ocean-mode-enable";
  const animation = readChoices(document, ":is(#animate-wind, #animate-currents, #animate-waves)");
  const isWave = animation.value === "animate-waves";
  const overlaySelector = isWave ? ".ocean-mode :is(#overlay-ocean-off, .waves-overlay)"
    : isOcean ? ".ocean-mode :is(#overlay-ocean-off, .currents-overlay)" : ".wind-mode [id^='overlay-']";
  const time = document.getElementById("data-date");
  const valid = time?.getAttribute("data-valid-utc");

  return {
    mode,
    isOcean,
    isWave,
    animation,
    height: readChoices(document, ".surface"),
    overlay: readChoices(document, overlaySelector),
    projection: readChoices(document, ".proj"),
    date: text("data-date").replace(/Local$/, "本地时间"),
    valid,
    archived: !!valid && Date.parse(valid) < Date.now() - 48 * 3600000,
    issue: time?.getAttribute("data-issue-utc"),
    forecast: time?.getAttribute("data-forecast-hour"),
    location: text("location-coord"),
    windValue: [text("location-wind"), text("location-wind-units")].filter(Boolean).join(" "),
    overlayValue: [text("location-value"), text("location-value-units")].filter(Boolean).join(" "),
    zone: text("toggle-zone").replace(/Local$/, "本地时间"),
    layer: text("data-layer"),
    source: text("data-center"),
    status: text("status"),
    paused: document.getElementById("option-pause-animation")?.classList.contains("highlighted") ?? false,
    showGrid: document.getElementById("option-show-grid")?.classList.contains("highlighted") ?? false,
  };
}

export function WeatherSidebarFilters({ frameDocument }: { frameDocument: Document | null }) {
  const [menu, setMenu] = useState<ReturnType<typeof readWeatherMenu> | null>(null);

  useEffect(() => {
    const sourceMenu = frameDocument?.getElementById("menu");
    if (!frameDocument || !sourceMenu) return;

    const syncMenu = () => setMenu(readWeatherMenu(frameDocument));
    const observer = new MutationObserver(syncMenu);
    observer.observe(sourceMenu, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "data-valid-utc", "data-issue-utc", "data-forecast-hour"] });
    const status = frameDocument.getElementById("status");
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true });
    const location = frameDocument.getElementById("location");
    if (location) observer.observe(location, { childList: true, characterData: true, subtree: true });
    const request = requestAnimationFrame(syncMenu);

    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
    };
  }, [frameDocument]);

  if (!frameDocument || !menu?.animation.value) return <p className="og-weather-sidebar-status" role="status">正在加载气象筛选…</p>;

  const select = (id: string) => frameDocument.getElementById(id)?.click();
  const timeSteps = menu.isOcean && !menu.isWave ? ["一个月", "五天"] : ["一天", "三小时"];

  return (
    <div className="og-weather-sidebar-filters">
      <div className="og-weather-sidebar-time">
        <p>数据时间</p>
        <div className="og-weather-sidebar-date">
          <time dateTime={menu.valid ?? undefined}>{menu.date || "等待气象数据"}</time>
          {menu.zone ? <button type="button" onClick={() => select("toggle-zone")} aria-label={menu.zone}>{menu.zone}</button> : null}
        </div>
        {menu.issue ? <p className="og-weather-sidebar-status">
          起报 {menu.issue.slice(0, 16).replace("T", " ")} UTC
          {menu.forecast !== null ? ` · +${menu.forecast} 小时` : ""}
        </p> : null}
        {menu.archived && menu.issue && !menu.isOcean
          ? <p className="og-weather-sidebar-status">归档 GFS · {menu.height.value === "surface-level" ? "10 米风场" : "高空风场"}</p> : null}
        <div className="og-weather-sidebar-nav" aria-label="时间控制">
          <button type="button" aria-label={menu.isWave ? "波浪首帧" : `后退${timeSteps[0]}`} onClick={() => select("nav-backward-more")}><ChevronsLeft size={17} /></button>
          <button type="button" aria-label={`后退${timeSteps[1]}`} onClick={() => select("nav-backward")}><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => select("nav-now")}>{menu.isOcean ? "最近" : "当前"}</button>
          <button type="button" aria-label={`前进${timeSteps[1]}`} onClick={() => select("nav-forward")}><ChevronRight size={16} /></button>
          <button type="button" aria-label={menu.isWave ? "波浪末帧" : `前进${timeSteps[0]}`} onClick={() => select("nav-forward-more")}><ChevronsRight size={17} /></button>
        </div>
      </div>
      <WorkspaceFilterSelect label="模式" {...menu.mode} onChange={select} />
      <div className="og-weather-sidebar-time">
        <p>动画</p>
        <div role="group" aria-label="动画" className="og-weather-sidebar-nav og-weather-sidebar-animation">
          {menu.animation.options.map(({ value, label }) => (
            <button key={value} type="button" aria-pressed={value === menu.animation.value} onClick={() => select(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {menu.isOcean ? null : (
        <WorkspaceFilterSelect label="高度" {...menu.height} options={menu.height.options.map((option) => (
          option.value.startsWith("isobaric-") ? { ...option, label: `${option.label} hPa` } : option
        ))} onChange={select} />
      )}
      <WorkspaceFilterSelect label="覆盖指标" {...menu.overlay} onChange={select} />
      <WorkspaceFilterSelect label="投影" {...menu.projection} onChange={select} />
      <div className="og-weather-sidebar-nav og-weather-sidebar-tools">
        <button type="button" aria-pressed={menu.showGrid} onClick={() => select("option-show-grid")}>网格点</button>
        <button type="button" onClick={() => select("show-location")}>当前位置</button>
        <button type="button" aria-pressed={menu.paused} onClick={() => select("option-pause-animation")}>
          {menu.paused ? "继续动画" : "暂停动画"}
        </button>
      </div>
      {menu.status ? <p className="og-weather-sidebar-status" role="status">{menu.status === "No Data" ? "当前筛选暂无气象数据" : menu.status}</p> : null}
      {menu.layer ? <p className="og-weather-sidebar-status">{menu.layer}</p> : null}
      {menu.source ? <p className="og-weather-sidebar-status">{menu.source}</p> : null}
      {menu.location ? <section className="og-weather-sample" aria-label="气象选点详情">
        <strong>{menu.location}</strong>
        <p>{menu.windValue}{menu.overlayValue ? " · " + menu.overlayValue : ""}</p>
        <button type="button" onClick={() => select("location-close")}>清除选点</button>
      </section> : null}
    </div>
  );
}

export function WeatherGlobeLegend({ frameDocument }: { frameDocument: Document | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [range, setRange] = useState<{ unit: string; high: string; low: string } | null>(null);
  useEffect(() => {
    const source = frameDocument?.querySelector<HTMLCanvasElement>("#scale");
    const target = canvas.current;
    if (!frameDocument || !source || !target) return;
    const read = (id: string) => frameDocument.getElementById(id)?.textContent?.trim() ?? "";
    const copy = () => {
      const high = read("scale-max");
      const low = read("scale-min");
      setRange(frameDocument.getElementById("weather-color-legend")?.hidden || !high || !low
        ? null : { unit: read("scale-label"), high, low });
      target.getContext("2d")?.drawImage(source, 0, 0);
    };
    const request = requestAnimationFrame(copy);
    source.addEventListener("weather-scale-change", copy);
    return () => {
      cancelAnimationFrame(request);
      source.removeEventListener("weather-scale-change", copy);
    };
  }, [frameDocument]);
  return <div className={styles.legend + " " + styles.weatherGlobe} aria-label="覆盖指标色阶" data-ready={Boolean(range)}>
    <strong>{range?.unit}</strong>
    <div className={styles.body}>
      <canvas ref={canvas} width={10} height={76} className={styles.ramp} aria-hidden="true" />
      <div className={styles.ticks}><span>{range?.high}</span><span>{range?.low}</span></div>
    </div>
  </div>;
}
