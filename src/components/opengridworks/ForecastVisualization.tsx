import { useId } from "react";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import styles from "./ForecastVisualization.module.css";

export type ForecastSample = {
  date: string;
  position: number;
  value: number | null;
  dateLabel: string;
  tickLabel: string;
  p10?: number;
  p90?: number;
};

type Vertex = { time: number; level: number; depth: number; lift: number };
type Profile = { time: number; level: number };
type Surface = { near: Vertex[]; far: Vertex[]; opacity: number };

const palettes = {
  power: [0x4772d2, 0x4cafd2, 0x62cebd, 0xafd398, 0xf2cb86],
  weather: [0x7474d4, 0x628be0, 0x65b9e1, 0x83d5dc, 0xc2f0e8],
  carbon: [0x496db8, 0x4d9cc3, 0x67bfb5, 0xa8d3a4, 0xdbce9c],
  economy: [0x796bcc, 0x997ed9, 0xcb9ecb, 0xebb69f, 0xecc78c],
} as const;
const benchmarkPalette = [0x4c6197, 0x5d7fb6, 0x77a3ca, 0x9abdd3, 0xbacbdc];
const axisNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumSignificantDigits: 4 });

const blend = (from: number, to: number, amount: number) => from + (to - from) * amount;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

function colorFor(stops: readonly number[], value: number) {
  const coordinate = clamp(value) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(coordinate));
  const channels = [16, 8, 0].map(shift =>
    Math.round(blend((stops[index] >> shift) & 255, (stops[index + 1] >> shift) & 255, coordinate - index)),
  );
  return "#" + channels.map(channel => channel.toString(16).padStart(2, "0")).join("");
}

function vertex(point: Profile, depth = 0, lift = 0, level = point.level): Vertex {
  return { time: point.time, level, depth, lift };
}

function project({ time, level, depth, lift }: Vertex) {
  return [43 + time * 174 + depth * 24, 130 + time * 9 - level * 94 - depth * 20 + lift] as const;
}

function coordinate(point: Vertex) {
  return project(point).map(value => value.toFixed(2)).join(" ");
}

function curve(points: Vertex[], start = "M") {
  let path = start + coordinate(points[0]);
  for (let i = 1; i < points.length; i++) {
    const startPoint = points[i - 1];
    const endPoint = points[i];
    const handle = (ratio: number, level: number) => coordinate({
      time: blend(startPoint.time, endPoint.time, ratio),
      level,
      depth: blend(startPoint.depth, endPoint.depth, ratio),
      lift: blend(startPoint.lift, endPoint.lift, ratio),
    });
    // Time and depth interpolate linearly. Keeping the height controls between their
    // endpoints makes the curve pass through observations without exceeding them.
    path += "C" + handle(1 / 3, startPoint.level) + " " + handle(2 / 3, endPoint.level) + " " + coordinate(endPoint);
  }
  return path;
}

function filledPath(near: Vertex[], far: Vertex[]) {
  return curve(near) + curve(far.toReversed(), "L") + "Z";
}

function continuousRuns<T, Sample extends T>(items: readonly T[], isValid: (item: T) => item is Sample) {
  const runs: Sample[][] = [];
  let run: Sample[] = [];
  for (const item of items) {
    if (!isValid(item)) {
      run = [];
    } else {
      if (!run.length) runs.push(run);
      run.push(item);
    }
  }
  return runs;
}

function surfacesFor(profile: Profile[], topic: WorkspaceTopic, baseline: number, depth: number, hasInterval: boolean): Surface[] {
  const ridge = profile.map(point => vertex(point, depth));
  const start = profile[0].time;
  const length = profile[profile.length - 1].time - start;
  const taper = (point: Profile) => Math.sin(Math.PI * clamp((point.time - start) / (length || 1)));

  switch (topic) {
    case "power": {
      const back = profile.map(point => vertex(point, depth + 0.86, -1));
      const bevel = profile.map(point => vertex(point, depth - 0.15, 4.8));
      return [{ near: ridge, far: bevel, opacity: 0.42 }, { near: ridge, far: back, opacity: 0.96 }];
    }
    case "weather": {
      const back = profile.map(point => vertex(point, depth + 0.38 + 0.55 * taper(point), -2 * taper(point)));
      const trailing = profile.map(point => vertex(point, depth + 1.02 + 0.18 * taper(point), 8 * taper(point)));
      const hem = profile.map(point => vertex(point, depth - 0.11 - 0.13 * taper(point), 2 + 6 * taper(point)));
      return [{ near: back, far: trailing, opacity: 0.23 }, { near: ridge, far: back, opacity: 0.78 }, { near: ridge, far: hem, opacity: 0.37 }];
    }
    case "carbon": {
      const shoulder = profile.map(point => vertex(point, depth + 0.38, 0, blend(point.level, baseline, hasInterval ? 0.04 : 0.18)));
      const foot = profile.map(point => vertex(point, depth + 0.94, 1, blend(point.level, baseline, hasInterval ? 0.13 : 0.79)));
      return [{ near: shoulder, far: foot, opacity: hasInterval ? 0.35 : 0.34 }, { near: ridge, far: shoulder, opacity: 0.83 }];
    }
    case "economy": {
      const shoulder = profile.map(point => vertex(point, depth + 0.36, -1));
      const hem = profile.map(point => vertex(point, depth - 0.1, 4.4));
      return [{ near: ridge, far: hem, opacity: 0.36 }, { near: ridge, far: shoulder, opacity: 0.92 }];
    }
  }
}

function hasBand(sample: ForecastSample): sample is ForecastSample & { p10: number; p90: number } {
  return sample.value !== null && sample.p10 !== undefined && sample.p90 !== undefined && sample.p10 <= sample.p90;
}

function markPath(point: Profile, depth: number) {
  const [x, y] = project(vertex(point, depth));
  // A one-period result still has a readable marker and a small projecting face.
  return `M${x - 5},${y + 1} Q${x - 6},${y} ${x - 3},${y - 2}l12,-6q3,-1.5 4.5,1l1,2q1,2 -2,3l-12,6q-3,1.5 -4.5,-1Z`;
}

type Projection = {
  level: (value: number) => number;
  baseline: number;
};

function SeriesSurface({ samples, palette, topic, projection, colorRatio, formatValue, benchmark = false, hasInterval = false }: {
  samples: readonly ForecastSample[];
  palette: readonly number[];
  topic: WorkspaceTopic;
  projection: Projection;
  colorRatio: (value: number) => number;
  formatValue: (value: number) => string;
  benchmark?: boolean;
  hasInterval?: boolean;
}) {
  const id = useId();
  const depth = benchmark ? 0.85 : 0;
  const runs = continuousRuns(samples.map(sample => sample.value === null ? null : {
    sample,
    value: sample.value,
    time: sample.position,
    level: projection.level(sample.value),
  }), point => point !== null);
  return (
    <g data-series={benchmark ? "benchmark" : "forecast"} className={benchmark ? styles.benchmark : undefined}>
      {runs.map((profile, index) => {
        const start = profile[0];
        const end = profile[profile.length - 1];
        const [x1] = project(vertex(start, depth));
        const [x2] = project(vertex(end, depth + (topic === "economy" ? 0.36 : 0.6)));
        const color = (value: number) => colorFor(palette, colorRatio(value));
        const fill = `url(#${id}-${index})`;
        return (
          <g key={start.sample.date} data-segment="">
            {profile.length === 1 ? (
              <path d={markPath(start, depth)} fill={color(start.value)} className={styles.station} />
            ) : (
              <>
                <linearGradient id={`${id}-${index}`} gradientUnits="userSpaceOnUse" x1={x1} x2={x2} y1="0" y2="0">
                  {profile.map(point => {
                    const [x] = project(vertex(point, depth));
                    return <stop key={point.sample.date} offset={clamp((x - x1) / (x2 - x1 || 1))} stopColor={color(point.value)} />;
                  })}
                  <stop offset="1" stopColor={color(end.value)} />
                </linearGradient>
                {surfacesFor(profile, topic, projection.baseline, depth, hasInterval).map(({ near, far, opacity }, surface) => (
                  <path key={surface} d={filledPath(near, far)} fill={fill} opacity={opacity} className={styles.surface} />
                ))}
                <path d={curve(profile.map(point => vertex(point, depth)))} className={styles.ridge}
                  stroke={benchmark ? "#c4d3ef" : fill} />
              </>
            )}
            {profile.map(({ sample, value, time, level }) => {
              const [x, y] = project(vertex({ time, level }, depth));
              const interval = hasInterval && hasBand(sample) ? ` · P10 ${formatValue(sample.p10)} · P90 ${formatValue(sample.p90)}` : "";
              return (
                <circle key={sample.date} cx={x} cy={y} r={profile.length > 14 ? 1.9 : 2.55}
                  fill={color(value)} className={styles.point}>
                  <title>{sample.dateLabel} · {formatValue(value)}{interval}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export function ForecastVisualization({ samples, comparison, topic, observed, label, unit, formatValue }: {
  samples: ForecastSample[];
  comparison?: { primaryLabel: string; label: string; samples: ForecastSample[] };
  topic: WorkspaceTopic;
  observed: boolean;
  label: string;
  unit: string;
  formatValue: (value: number) => string;
}) {
  const id = useId();
  const bands = topic === "carbon" ? continuousRuns(samples, hasBand) : [];
  const values = [...samples, ...(comparison?.samples ?? [])].flatMap(({ value }) => value === null ? [] : [value]);
  const bounds = bands.flatMap(run => run.flatMap(({ p10, p90 }) => [p10, p90]));
  const min = Math.min(...values, ...bounds);
  const max = Math.max(...values, ...bounds);
  const span = max - min;
  const padding = (span || Math.abs(max) || 1) * 0.13;
  const low = min >= 0 ? Math.max(0, min - padding) : min - padding;
  const high = max < 0 ? Math.min(0, max + padding) : max + padding;
  const level = (value: number) => (value - low) / (high - low);
  const baseline = level(Math.max(low, Math.min(0, high)));
  const projection = { level, baseline };
  const colorRatio = (value: number) => span ? (value - min) / span : 0.5;
  const crossesZero = min < 0 && max >= 0;
  const middle = crossesZero && Math.min(-min, max) / span > 0.16 ? 0 : min / 2 + max / 2;
  const ticks = min === max ? [min] : [max, middle, min];
  const seenTicks = new Set<string>();
  const first = samples[0];
  const last = samples[samples.length - 1];

  return (
    <figure className={styles.graphic} data-topic={topic} data-observed={observed}>
      <svg viewBox="0 0 260 166" role="img" aria-label={label} aria-describedby={`${id}-description`} className={styles.plot}>
        <desc id={`${id}-description`}>{[
          `时间序列，单位 ${unit}。标记为原始值。`,
          comparison && `${comparison.primaryLabel}与${comparison.label}使用相同尺度。`,
          bands.length > 0 && "半透明区域为模型提供的 P10–P90 预测区间。",
        ].filter(Boolean).join("")}</desc>
        <defs>
          <radialGradient id={`${id}-shadow`}>
            <stop offset="0" className={styles.shadowColor} />
            <stop offset="1" className={styles.shadowColor} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-interval`} x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#628ac7" stopOpacity="0.17" />
            <stop offset="0.7" stopColor="#80beba" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ccddba" stopOpacity="0.54" />
          </linearGradient>
        </defs>
        <ellipse cx="132" cy="137" rx="108" ry="11" fill={`url(#${id}-shadow)`} opacity="0.45" aria-hidden="true" />
        <path d="M43 136 L225 145" className={styles.timeAxis} />
        {crossesZero && (
          <path d={`M${coordinate(vertex({ time: 0, level: baseline }))}L${coordinate(vertex({ time: 1, level: baseline }))}`}
            className={styles.zero} />
        )}
        {bands.map(run => {
          const vertices = (key: "p10" | "p90") => run.map(sample => vertex({ time: sample.position, level: level(sample[key]) }, 0.19));
          const lower = vertices("p10");
          const upper = vertices("p90");
          return run.length === 1 ? (
            <g key={run[0].date} data-interval="" className={styles.intervalStem}>
              <path d={curve([lower[0], upper[0]])} />
              {[lower[0], upper[0]].map((point, edge) => {
                const [x, y] = project(point);
                return <path key={edge} d={`M${x - 4} ${y}h8`} />;
              })}
            </g>
          ) : <path key={run[0].date} data-interval="" d={filledPath(lower, upper)} fill={`url(#${id}-interval)`} className={styles.interval} />;
        })}
        {comparison && (
          <SeriesSurface samples={comparison.samples} palette={benchmarkPalette} topic={topic} projection={projection}
            colorRatio={colorRatio} formatValue={formatValue} benchmark />
        )}
        <SeriesSurface samples={samples} palette={palettes[topic]} topic={topic} projection={projection}
          colorRatio={colorRatio} formatValue={formatValue} hasInterval={bands.length > 0} />
        {ticks.map(value => {
          const tick = axisNumber.format(value);
          if (seenTicks.has(tick)) return null;
          seenTicks.add(tick);
          const [, y] = project(vertex({ time: 0, level: level(value) }));
          return (
            <g key={value}>
              <path d={`M38 ${y}h4`} className={styles.tick} />
              <text x="35" y={y} dy=".34em" textAnchor="end" textLength={tick.length > 4 ? 32 : undefined}
                lengthAdjust="spacingAndGlyphs">{tick}</text>
            </g>
          );
        })}
        <text x="8" y="16" className={styles.unit}>{unit}</text>
        {first.tickLabel === last.tickLabel ? (
          <text x="130" y="160" textAnchor="middle">{first.tickLabel}</text>
        ) : (
          <>
            <text x="43" y="158">{first.tickLabel}</text>
            <text x="225" y="158" textAnchor="end">{last.tickLabel}</text>
          </>
        )}
      </svg>
      {(comparison || bands.length > 0) && (
        <figcaption className={styles.legend}>
          {comparison && <>
            <span><i className={styles.primaryKey} />{comparison.primaryLabel}</span>
            <span><i className={styles.benchmarkKey} />{comparison.label}</span>
          </>}
          {bands.length > 0 && <span><i className={styles.intervalKey} />P10–P90 预测区间</span>}
        </figcaption>
      )}
    </figure>
  );
}
