import type { ChinaDashboardQuality } from "@/lib/china-dashboard";
import styles from "./china-dashboard.module.css";

export function DataQualityPanel({ quality, open }: { quality: ChinaDashboardQuality | null; open: boolean }) {
  return (
    <section className={`${styles.ledgerPanel} ${open ? styles.ledgerOpen : ""}`} aria-hidden={!open}>
      {(quality?.sources ?? []).map((source) => (
        <article key={source.id}>
          <b>{source.identity === "official-statistic" ? "官方统计" : "地图样本"}｜{source.label}</b>
          <span>{source.scope}；{source.usedAsGeometry ? "可用于地图几何" : "不作为坐标来源"}。{source.timeRange ? ` ${source.timeRange}。` : ""}{source.limitation ?? ""}</span>
        </article>
      ))}
      <article><b>预测链｜未接入</b><span>{quality?.notice ?? "正在读取预测就绪状态…"}</span></article>
    </section>
  );
}
