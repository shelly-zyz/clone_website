import {
  CHINA_VOLTAGE_CLASSES,
  CHINA_VOLTAGE_COLORS,
  type ChinaOsmFeatureLayer,
  type ChinaVoltageClass,
} from "@/lib/china-layer-styles";
import styles from "./china-dashboard.module.css";

const featureLabels: Record<ChinaOsmFeatureLayer, string> = {
  lines: "输电线",
  substations: "变电站",
  plants: "电厂",
  generators: "发电单元",
};

export function LayerControlStrip({
  visible,
  featureLayers,
  voltages,
  detail,
  status,
  onFeatureToggle,
  onVoltageToggle,
  onDetailChange,
}: {
  visible: boolean;
  featureLayers: Record<ChinaOsmFeatureLayer, boolean>;
  voltages: ReadonlySet<ChinaVoltageClass>;
  detail: "overview" | "detail";
  status: "idle" | "loading" | "ready" | "error";
  onFeatureToggle: (layer: ChinaOsmFeatureLayer) => void;
  onVoltageToggle: (voltage: ChinaVoltageClass) => void;
  onDetailChange: (detail: "overview" | "detail") => void;
}) {
  if (!visible) return null;

  const statusLabel = status === "ready" ? "瓦片就绪" : status === "error" ? "瓦片不可用" : status === "loading" ? "加载瓦片" : "准备图层";
  return (
    <section className={styles.denseControls} aria-label="OSM 密集电网图层控制">
      <header><b>OSM 2026-05-17</b><span className={styles[`tileStatus${status}`]}>{statusLabel}</span><small>z3–5 · 53 个 PBF</small></header>
      <div className={styles.denseControlRow}>
        <span>设施</span>
        {Object.entries(featureLabels).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={featureLayers[key as ChinaOsmFeatureLayer]} className={featureLayers[key as ChinaOsmFeatureLayer] ? styles.controlActive : ""} onClick={() => onFeatureToggle(key as ChinaOsmFeatureLayer)}>{label}</button>
        ))}
        <button type="button" aria-pressed={detail === "overview"} className={detail === "overview" ? styles.controlActive : ""} onClick={() => onDetailChange("overview")}>概览</button>
        <button type="button" aria-pressed={detail === "detail"} title="加载 z4–5 高细节瓦片，数据量较大" className={detail === "detail" ? styles.controlActive : ""} onClick={() => onDetailChange("detail")}>详细 · 高负载</button>
      </div>
      <div className={styles.denseControlRow}>
        <span>电压</span>
        {CHINA_VOLTAGE_CLASSES.map((voltage) => (
          <button key={voltage} type="button" aria-pressed={voltages.has(voltage)} className={voltages.has(voltage) ? styles.controlActive : ""} onClick={() => onVoltageToggle(voltage)}>
            <i style={{ background: CHINA_VOLTAGE_COLORS[voltage] }} />{voltage === "low" ? "其他" : `${voltage}kV`}
          </button>
        ))}
      </div>
    </section>
  );
}
