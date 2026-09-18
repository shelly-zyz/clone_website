"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ChinaDashboardOverview,
  ChinaLayerCatalog,
} from "@/lib/china-dashboard";
import type { PredictionModelRegistry, PredictionRealBaselineBacktest, PredictionStatus } from "@/lib/prediction/contracts";
import type { RegionSummary, RegionTheme } from "@/lib/regions/contracts";
import type { VoiceDashboardCommand } from "@/lib/voice/voice-state";
import { ChinaMapScene } from "./ChinaMapScene";
import { AskEnergyPanel } from "./AskEnergyPanel";
import { XiaoyunAssistant } from "./XiaoyunAssistant";
import { LeftAnalysisRail } from "./LeftAnalysisRail";
import { RegionAnalysisRail } from "./RegionAnalysisRail";
import styles from "./china-dashboard.module.css";

const provinces = ["全国", "新疆", "内蒙古", "四川", "山东", "广东"];

export function ChinaDashboardShell() {
  const router = useRouter();
  const [overview, setOverview] = useState<ChinaDashboardOverview | null>(null);
  const [layers, setLayers] = useState<ChinaLayerCatalog | null>(null);
  const [predictionStatus, setPredictionStatus] = useState<PredictionStatus | null>(null);
  const [modelRegistry, setModelRegistry] = useState<PredictionModelRegistry | null>(null);
  const [realBacktest, setRealBacktest] = useState<PredictionRealBaselineBacktest | null>(null);
  const [scope, setScope] = useState("全国");
  const [theme, setTheme] = useState<RegionTheme>("power");
  const [regionSummary, setRegionSummary] = useState<RegionSummary | null>(null);
  const [regionLoading, setRegionLoading] = useState(true);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [toast, setToast] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState("osm-power");

  useEffect(() => {
    let active = true;
    const load = <T,>(url: string, apply: (value: T) => void) => {
      fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`${url} returned ${response.status}`);
          return response.json() as Promise<T>;
        })
        .then((value) => { if (active) apply(value); })
        .catch(() => { if (active) setToast("部分仪表盘数据接口暂不可用，未使用替代数据。"); });
    };
    load<ChinaDashboardOverview>("/api/china-dashboard/overview", setOverview);
    load<ChinaLayerCatalog>("/api/china-dashboard/layers", setLayers);
    load<PredictionStatus>("/api/prediction/status?country=CHN", setPredictionStatus);
    load<PredictionModelRegistry>("/api/prediction/models?country=CHN", setModelRegistry);
    load<PredictionRealBaselineBacktest>("/api/prediction/backtest?country=CHN", setRealBacktest);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
    }).format(new Date()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const requestedProvince = params.get("province");
    const requestedTheme = params.get("theme");
    const timer = window.setTimeout(() => {
      if (requestedProvince) setScope(requestedProvince);
      if (requestedTheme === "power" || requestedTheme === "weather" || requestedTheme === "carbon") setTheme(requestedTheme);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const regionId = scope === "全国" ? "CN" : scope;
    const metric = theme === "weather" ? "wind" : theme === "carbon" ? "Power" : "assets";
    const expected = `${regionId}:${theme}:${metric}`;
    const loadingTimer = window.setTimeout(() => {
      setRegionLoading(true);
      setRegionError(null);
    }, 0);
    fetch(`/api/regions/summary?regionId=${encodeURIComponent(regionId)}&theme=${theme}&metric=${metric}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`地区摘要接口返回 ${response.status}`);
        return response.json() as Promise<RegionSummary>;
      })
      .then((value) => {
        const actual = `${value.request.regionId === "CN" ? "CN" : value.request.regionName}:${value.request.theme}:${value.request.metric ?? metric}`;
        if (actual !== expected && value.request.regionName !== scope) return;
        setRegionSummary(value);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRegionSummary(null);
        setRegionError("地区数据暂不可用，请稍后重试。");
      })
      .finally(() => { if (!controller.signal.aborted) setRegionLoading(false); });
    return () => { window.clearTimeout(loadingTimer); controller.abort(); };
  }, [scope, theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentSummary = useMemo(() => (
    regionSummary?.request.theme === theme && regionSummary.request.regionName === scope ? regionSummary : null
  ), [regionSummary, scope, theme]);
  const scopeNote = currentSummary?.coverage.label ?? (scope === "全国"
    ? "正在汇总全国数据"
    : "按已审核省界汇总；空结果不等于官方为零");
  const currentRegionLoading = regionLoading || (!currentSummary && !regionError);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  const applyScope = (next: string) => {
    setScope(next);
    setToast(`${next}范围已同步到地图与样本口径。`);
  };

  const applyVoiceCommand = (command: VoiceDashboardCommand) => {
    if (command.type === "select-province") applyScope(command.province);
    else setAskOpen(false);
  };

  return (
    <main className={styles.screen}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <button className={styles.back} type="button" onClick={goBack}>← 返回电力地球</button>
          <span className={styles.bolt}>ϟ</span>
          <div><h1>中国电力运行研究台</h1><p>POWER · WEATHER · CARBON ANALYSIS</p></div>
        </div>
        <div className={styles.topCenter}>
          <nav className={styles.themeNav} aria-label="分析专题">
            {(["power", "weather", "carbon"] as RegionTheme[]).map((item) => <button key={item} type="button" aria-pressed={theme === item} onClick={() => setTheme(item)}>{item === "power" ? "电力" : item === "weather" ? "气象" : "碳排放"}</button>)}
          </nav>
          <button className={styles.askToggle} type="button" aria-expanded={askOpen} onClick={() => setAskOpen((value) => !value)}>⌁ 能源问数</button>
        </div>
        <div className={styles.topStatus}>
          <div><strong>{clock} CST</strong><span>Asia / Shanghai</span></div>
          <span className={styles.health}><i /> 数据身份可追溯</span>
        </div>
      </header>

      <section className={styles.workspace}>
        <LeftAnalysisRail overview={overview} scope={scope} theme={theme} summary={currentSummary} />
        <ChinaMapScene
          layers={layers}
          provinces={provinces}
          scope={scope}
          scopeNote={scopeNote}
          theme={theme}
          onScopeChange={applyScope}
          onNotice={setToast}
          onLayerContextChange={setSelectedLayer}
        />
        <RegionAnalysisRail
          summary={currentSummary}
          loading={currentRegionLoading}
          error={regionError}
          theme={theme}
          status={predictionStatus}
          registry={modelRegistry}
          realBacktest={realBacktest}
        />
      </section>

      {askOpen ? <AskEnergyPanel context={{ selectedProvince: scope, selectedLayer, timeMode: "current" }} onClose={() => setAskOpen(false)} onDashboardCommand={applyVoiceCommand} /> : null}
      <XiaoyunAssistant context={{ selectedProvince: scope, selectedLayer, timeMode: "current" }} onDashboardCommand={applyVoiceCommand} onOpenPanel={() => setAskOpen(true)} />

      <div className={`${styles.toast} ${toast ? styles.toastVisible : ""}`}>{toast}</div>
    </main>
  );
}
