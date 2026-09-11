"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ChinaDashboardOverview,
  ChinaLayerCatalog,
} from "@/lib/china-dashboard";
import type { PredictionModelRegistry, PredictionRealBaselineBacktest, PredictionStatus } from "@/lib/prediction/contracts";
import { ChinaMapScene } from "./ChinaMapScene";
import { LeftAnalysisRail } from "./LeftAnalysisRail";
import { PredictionWorkflowRail } from "./PredictionWorkflowRail";
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
  const [step, setStep] = useState(0);
  const [pageVisible, setPageVisible] = useState(true);
  const [clock, setClock] = useState("");
  const [toast, setToast] = useState("");

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
    load<PredictionStatus>("/api/prediction/status", setPredictionStatus);
    load<PredictionModelRegistry>("/api/prediction/models", setModelRegistry);
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
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!pageVisible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setStep((value) => (value + 1) % 6), 1_650);
    return () => window.clearInterval(timer);
  }, [pageVisible]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const scopeNote = useMemo(() => scope === "全国"
    ? "公开设施 / OSM / 来源质量"
    : "省级样本按边界筛选；空结果不等于官方为零", [scope]);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <main className={styles.screen}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <button className={styles.back} type="button" onClick={goBack}>← 返回电力地球</button>
          <span className={styles.bolt}>ϟ</span>
          <div><h1>中国电力运行研究台</h1><p>POWER · TERRAIN · FORECAST WORKFLOW</p></div>
        </div>
        <span className={styles.modeBadge}>真实数据界面 · 预测锁定</span>
        <div className={styles.topStatus}>
          <div><strong>{clock} CST</strong><span>Asia / Shanghai</span></div>
          <span className={styles.health}><i /> 数据身份可追溯</span>
        </div>
      </header>

      <section className={styles.workspace}>
        <LeftAnalysisRail overview={overview} scope={scope} />
        <ChinaMapScene
          layers={layers}
          provinces={provinces}
          scope={scope}
          scopeNote={scopeNote}
          step={step}
          onScopeChange={(next) => {
            setScope(next);
            setToast(`${next}范围已同步到地图与样本口径。`);
          }}
          onNotice={setToast}
        />
        <PredictionWorkflowRail
          currentStep={step}
          scope={scope}
          status={predictionStatus}
          registry={modelRegistry}
          realBacktest={realBacktest}
          currentWeatherAvailable={layers?.layers.some((layer) => layer.id === "gfs-weather" && layer.status === "available") ?? false}
        />
      </section>

      <div className={`${styles.toast} ${toast ? styles.toastVisible : ""}`}>{toast}</div>
      <div className={styles.narrowWarning}>请使用 PC 宽屏查看完整中国电力研究台</div>
    </main>
  );
}
