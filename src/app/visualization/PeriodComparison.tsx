import { ArrowDownToLine, ArrowRightLeft } from "lucide-react";
import type { ReactNode } from "react";
import { chartStory } from "@/lib/topic-analysis/chart-story";
import { formatAnalysisValue, type AnalysisChartSpec, type Value } from "@/lib/topic-analysis/model";
import { AnalysisInsights, AnalysisNarrative } from "./AnalysisNarrative";
import styles from "./page.module.css";

type ComparisonSide = {
  heading: string;
  controls: ReactNode;
  value: Value;
  detail: string;
};

export function PeriodComparison({ spec, first, second, empty, onSwap, exportHref }: {
  spec: AnalysisChartSpec;
  empty?: string;
  first: ComparisonSide;
  second: ComparisonSide;
  onSwap?: () => void;
  exportHref?: string;
}) {
  const { id, title, caption, unit, sources } = spec;
  const story = chartStory(spec, empty);
  const delta = first.value !== null && second.value !== null ? second.value - first.value : null;
  const percentage = delta !== null && first.value !== null && first.value > 0 ? delta / first.value * 100 : null;

  return (
    <section id={id} className={styles.comparison} aria-labelledby={id + "-title"}>
      <header className={styles.comparisonHeader}>
        <div>
          <h2 id={id + "-title"}>{title}</h2>
          <p>{caption}</p>
        </div>
        {onSwap && (
          <button className={styles.compareAction} type="button" onClick={onSwap}>
            <ArrowRightLeft size={15} aria-hidden="true" />交换 A/B
          </button>
        )}
      </header>
      <div className={styles.comparisonColumns}>
        {[first, second].map(({ heading, controls, value, detail }, index) => (
          <div key={index} className={styles.comparisonSide}>
            <h3><span aria-hidden="true">{index ? "B" : "A"}</span>{heading}</h3>
            {controls}
            <div className={styles.comparisonValue} aria-live="polite">
              <strong>{formatAnalysisValue(value)}</strong>
              {value !== null && <span>{unit}</span>}
            </div>
            <p>{detail}</p>
          </div>
        ))}
      </div>
      <AnalysisInsights id={id} story={story} />
      <footer className={styles.comparisonFooter}>
        <div aria-live="polite">
          <span>B 相对 A</span>
          {delta === null ? <strong>暂无可比值</strong> : (
            <>
              <strong>{delta > 0 ? "+" : ""}{formatAnalysisValue(delta)} {unit}</strong>
              <span>{percentage === null ? "A 为零，未计算变化率" : `${percentage > 0 ? "+" : ""}${formatAnalysisValue(percentage)}%`}</span>
            </>
          )}
        </div>
        <div>
          {exportHref && (
            <a className={styles.compareAction} href={exportHref} download={id + ".csv"}>
              <ArrowDownToLine size={15} aria-hidden="true" />下载 CSV
            </a>
          )}
        </div>
      </footer>
      <AnalysisNarrative story={story} caption={caption} sources={sources} />
    </section>
  );
}
