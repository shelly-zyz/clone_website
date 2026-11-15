import { useId } from "react";
import styles from "./ForecastSidebar.module.css";

type RibbonSample = {
  date: string;
  position: number;
  value: number | null;
  dateLabel: string;
  tickLabel: string;
};

type Coordinate = [number, number];

const axisNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumSignificantDigits: 4 });
const timeGrid = [0, 0.25, 0.5, 0.75, 1];

function project(position: number, level: number, depth = 0): Coordinate {
  return [43 + position * 176 + depth * 28, 124 + position * 11 - level * 82 - depth * 23];
}

function polygon(coordinates: Coordinate[]) {
  return coordinates.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

export function ForecastRibbon({ samples, observed, label, unit, formatValue }: {
  samples: RibbonSample[];
  observed: boolean;
  label: string;
  unit: string;
  formatValue: (value: number) => string;
}) {
  const id = useId();
  const numbers = samples.flatMap(({ value }) => value === null ? [] : [value]);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const padding = (max - min || Math.abs(max) || 1) * 0.12;
  const low = min >= 0 ? Math.max(0, min - padding) : min - padding;
  const high = max < 0 ? Math.min(0, max + padding) : max + padding;
  const level = (value: number) => (value - low) / (high - low);
  const baseline = level(Math.max(low, Math.min(0, high)));
  const ticks = min === max ? [low, low / 2 + high / 2, high] : [min, min / 2 + max / 2, max];
  const first = samples[0];
  const last = samples[samples.length - 1];
  const runs: { sample: RibbonSample; value: number }[][] = [];
  let run: (typeof runs)[number] = [];
  for (const sample of samples) {
    if (sample.value === null) {
      run = [];
    } else {
      if (run.length === 0) runs.push(run);
      run.push({ sample, value: sample.value });
    }
  }

  return (
    <svg viewBox="0 0 260 166" role="img" aria-label={label} className={styles.ribbon} data-observed={observed}>
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="25" x2="0" y2="137" gradientUnits="userSpaceOnUse">
          <stop offset="0" className={styles.faceLight} />
          <stop offset="1" className={styles.faceDark} />
        </linearGradient>
        <linearGradient id={`${id}-ridge`} x1="40" y1="0" x2="248" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" className={styles.ridgeCool} />
          <stop offset="1" className={styles.ridgeWarm} />
        </linearGradient>
      </defs>

      <polygon className={styles.backPlane} points={polygon([project(0, 0, 1), project(1, 0, 1), project(1, 1, 1), project(0, 1, 1)])} />
      <polygon className={styles.floorPlane} points={polygon([project(0, 0), project(1, 0), project(1, 0, 1), project(0, 0, 1)])} />
      <polygon className={styles.sidePlane} points={polygon([project(0, 0), project(0, 0, 1), project(0, 1, 1), project(0, 1)])} />
      {timeGrid.map(position => (
        <polyline key={position} className={styles.ribbonGrid}
          points={polygon([project(position, 0), project(position, 0, 1), project(position, 1, 1)])} />
      ))}
      {ticks.map((value, index) => {
        const y = level(value);
        return (
          <g key={index}>
            <polyline className={styles.ribbonGrid} points={polygon([project(0, y), project(0, y, 1), project(1, y, 1)])} />
            <text x="38" y={project(0, y)[1]} dy="0.34em" textAnchor="end">{axisNumber.format(value)}</text>
          </g>
        );
      })}
      {min < 0 && max > 0 && (
        <polyline className={styles.zeroLine} points={polygon([project(0, baseline), project(1, baseline)])} />
      )}

      {runs.map(samplesInRun => {
        const front = samplesInRun.map(({ sample, value }) => project(sample.position, level(value), 0.12));
        const back = samplesInRun.map(({ sample, value }) => project(sample.position, level(value), 0.69));
        const start = samplesInRun[0].sample.position;
        const end = samplesInRun[samplesInRun.length - 1].sample.position;
        const startBase = project(start, baseline, 0.12);
        const endBase = project(end, baseline, 0.12);
        const endBackBase = project(end, baseline, 0.69);
        return (
          <g key={samplesInRun[0].sample.date}>
            {front.length === 1 ? (
              <polyline className={styles.singleStem} points={polygon([startBase, front[0], back[0]])} />
            ) : (
              <>
                <polygon className={styles.ribbonEnd} points={polygon([front[front.length - 1], back[back.length - 1], endBackBase, endBase])} />
                <polygon fill={`url(#${id}-face)`} points={polygon([startBase, ...front, endBase])} />
                <polygon className={styles.ribbonTop} fill={`url(#${id}-ridge)`} points={polygon([...front, ...back.toReversed()])} />
                <polyline className={styles.ribbonEdge} points={polygon(front)} />
              </>
            )}
            {samplesInRun.map(({ sample, value }, index) => (
              <circle key={sample.date} className={styles.ribbonPoint} cx={front[index][0]} cy={front[index][1]} r={front.length > 12 ? 1.8 : 2.7}>
                <title>{sample.dateLabel} · {formatValue(value)}</title>
              </circle>
            ))}
          </g>
        );
      })}
      <text x="12" y="17">{unit}</text>
      {first.tickLabel === last.tickLabel ? (
        <text x="131" y="154" textAnchor="middle">{first.tickLabel}</text>
      ) : (
        <>
          <text x="43" y="154">{first.tickLabel}</text>
          <text x="219" y="154" textAnchor="end">{last.tickLabel}</text>
        </>
      )}
    </svg>
  );
}
