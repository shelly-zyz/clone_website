"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WorkspaceFilterSelect, type WorkspaceFilterOption } from "./WorkspaceSidebar";

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

  return {
    mode,
    isOcean,
    height: readChoices(document, ".surface"),
    overlay: readChoices(document, `${isOcean ? ".ocean-mode" : ".wind-mode"} [id^='overlay-']`),
    projection: readChoices(document, ".proj"),
    date: text("data-date").replace(/Local$/, "本地时间"),
    zone: text("toggle-zone").replace(/Local$/, "本地时间"),
    layer: text("data-layer"),
    source: text("data-center"),
    status: text("status"),
    showGrid: document.getElementById("option-show-grid")?.classList.contains("highlighted") ?? false,
  };
}

export function WeatherSidebarFilters({ frameDocument }: { frameDocument: Document | null }) {
  const [menu, setMenu] = useState<ReturnType<typeof readWeatherMenu> | null>(null);
  const colorScale = useRef<HTMLCanvasElement>(null);
  const menuReady = menu !== null;

  useEffect(() => {
    const sourceMenu = frameDocument?.getElementById("menu");
    if (!frameDocument || !sourceMenu) return;

    const syncMenu = () => setMenu(readWeatherMenu(frameDocument));
    const observer = new MutationObserver(syncMenu);
    observer.observe(sourceMenu, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    const status = frameDocument.getElementById("status");
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true });
    const request = requestAnimationFrame(syncMenu);

    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
    };
  }, [frameDocument]);

  useEffect(() => {
    const source = frameDocument?.querySelector<HTMLCanvasElement>("#scale");
    const target = colorScale.current;
    if (!menuReady || !source || !target) return;

    const copyScale = () => {
      if (!source.width || !source.height) return;
      target.width = source.width;
      target.height = source.height;
      target.getContext("2d")?.drawImage(source, 0, 0);
    };
    copyScale();
    source.addEventListener("weather-scale-change", copyScale);
    return () => source.removeEventListener("weather-scale-change", copyScale);
  }, [frameDocument, menuReady]);

  if (!frameDocument || !menu) return <p className="og-weather-sidebar-status" role="status">正在加载气象筛选…</p>;

  const select = (id: string) => frameDocument.getElementById(id)?.click();
  const timeSteps = menu.isOcean ? ["一个月", "五天"] : ["一天", "三小时"];

  return (
    <div className="og-weather-sidebar-filters">
      <div className="og-weather-sidebar-time">
        <p>数据时间</p>
        <div className="og-weather-sidebar-date">
          <time>{menu.date || "等待气象数据"}</time>
          {menu.zone ? <button type="button" onClick={() => select("toggle-zone")} aria-label={menu.zone}>{menu.zone}</button> : null}
        </div>
        <div className="og-weather-sidebar-nav" aria-label="时间控制">
          <button type="button" aria-label={`后退${timeSteps[0]}`} onClick={() => select("nav-backward-more")}><ChevronsLeft size={17} /></button>
          <button type="button" aria-label={`后退${timeSteps[1]}`} onClick={() => select("nav-backward")}><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => select("nav-now")}>当前</button>
          <button type="button" aria-label={`前进${timeSteps[1]}`} onClick={() => select("nav-forward")}><ChevronRight size={16} /></button>
          <button type="button" aria-label={`前进${timeSteps[0]}`} onClick={() => select("nav-forward-more")}><ChevronsRight size={17} /></button>
        </div>
      </div>
      <WorkspaceFilterSelect label="模式" {...menu.mode} onChange={select} />
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
      </div>
      {menu.status ? <p className="og-weather-sidebar-status" role="status">{menu.status === "No Data" ? "当前筛选暂无气象数据" : menu.status}</p> : null}
      {menu.layer ? <p className="og-weather-sidebar-status">{menu.layer}</p> : null}
      <canvas ref={colorScale} className="og-weather-sidebar-scale" aria-label="覆盖指标色阶" role="img" />
      {menu.source ? <p className="og-weather-sidebar-status">{menu.source}</p> : null}
    </div>
  );
}
