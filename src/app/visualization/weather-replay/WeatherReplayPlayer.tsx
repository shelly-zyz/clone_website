"use client";

import { Pause, Play, Rotate3D } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { replayViewOrder, replayViews, type ReplayView } from "@/lib/weather-replay/views";
import { accumulatedRain, paintReplay, utcClock } from "./replay-canvas";
import styles from "./player.module.css";

const control = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-800 hover:bg-slate-200";
const selected = "aria-pressed:bg-teal-800 aria-pressed:text-white";

export function WeatherReplayPlayer({ query, scene }: { query: string; scene?: ReplayView }) {
  const [selectedView, setSelectedView] = useState<ReplayView>("weather");
  const view = scene ?? selectedView;
  const embedded = scene !== undefined;
  const [replay, setReplay] = useState<WeatherReplay | null>(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    fetch(query ? `/api/weather-replay?${query}` : "/api/weather-replay", { signal: request.signal })
      .then(async response => {
        if (!response.ok) {
          const payload: { error?: string } = await response.json();
          throw new Error(payload.error || "暂时无法加载区域回放。");
        }
        return response.json() as Promise<WeatherReplay>;
      })
      .then(setReplay)
      .catch(error => { if (!request.signal.aborted) setFailure(error instanceof Error ? error.message : "区域回放加载失败。"); });
    return () => request.abort();
  }, [attempt, query]);

  return (
    <section className={embedded ? styles.embedded : styles.standalone} aria-label="区域风暴 3D 回放">
      {!embedded && <h1>区域风暴 3D 回放</h1>}
      {replay ? <ReplayControls key={query} replay={replay} view={view} onViewChange={embedded ? undefined : setSelectedView} /> : failure ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p role="alert">{failure}</p>
          <button className={control} onClick={() => { setFailure(""); setAttempt(value => value + 1); }}>重试</button>
        </div>
      ) : <p className="mt-3 text-sm text-slate-600" role="status">正在加载云图和降水帧…</p>}
    </section>
  );
}

function ReplayControls({ replay, view, onViewChange }: {
  replay: WeatherReplay;
  view: ReplayView;
  onViewChange?: (view: ReplayView) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [clouds, setClouds] = useState(true);
  const [precipitation, setPrecipitation] = useState(true);
  const [index, setIndex] = useState(Math.min(8, replay.rain.length - 1));
  const previousIndex = useRef(index);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const final = replay.rain.length - 1;
  const timestamp = replay.rain[index].time;
  const satellite = replay.satellite.findLast(frame => frame.time <= timestamp);
  const totals = useMemo(() => view === "accumulation" ? accumulatedRain(replay, index) : undefined, [index, replay, view]);
  const accumulationPeak = totals ? Math.max(...totals.map(value => value ?? 0)) : 0;
  const peaks = useMemo(() => replay.rain.map(frame => Math.max(...frame.values.map(value => value ?? 0))), [replay]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const next = index + 1;
      setIndex(next);
      if (next >= final) setPlaying(false);
    }, 530);
    return () => window.clearTimeout(timer);
  }, [final, index, playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const previous = previousIndex.current;
    previousIndex.current = index;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animate = previous !== index && view === "weather";
    const rainMotion = view === "rain" && playing;

    const started = performance.now();
    let pending = 0;
    const draw = (now: number) => {
      const progress = animate && !motion.matches ? Math.min(1, (now - started) / 240) : 1;
      const phase = rainMotion && !motion.matches ? now / 1000 : 0;
      paintReplay(canvas, replay, { index, view, rotation, clouds, precipitation, previous, progress, phase, totals });
      if (progress < 1 || (rainMotion && !motion.matches)) pending = requestAnimationFrame(draw);
    };
    pending = requestAnimationFrame(draw);
    const redraw = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(draw);
    };
    const size = new ResizeObserver(redraw);
    size.observe(canvas);
    motion.addEventListener("change", redraw);
    return () => {
      cancelAnimationFrame(pending);
      size.disconnect();
      motion.removeEventListener("change", redraw);
    };
  }, [clouds, index, playing, precipitation, replay, rotation, totals, view]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
    } else {
      if (index >= final) setIndex(0);
      setPlaying(true);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <h2>{replayViews[view].title}</h2>
          <p>{replay.region} · {timestamp.slice(0, 10)} UTC</p>
        </div>
        <button className={control} onClick={() => setRotation(value => (value + 1) % 4)}>
          <Rotate3D size={16} aria-hidden="true" /> 旋转视角
        </button>
      </header>
      {onViewChange && (
        <div role="group" aria-label="回放视图" className={styles.standaloneViews}>
          {replayViewOrder.map(item => (
            <button key={item} className={`${control} ${selected}`} aria-pressed={view === item} onClick={() => onViewChange(item)}>
              {replayViews[item].title}
            </button>
          ))}
        </div>
      )}
      <div className={styles.stage}>
        <canvas ref={canvasRef} role="img"
          aria-label={replayViews[view].description}
          className={styles.canvas} />
          {view === "rain" && (
            <p className={styles.rainReading}>
              区域峰值 <strong>{peaks[index].toFixed(1)}</strong> mm/h{peaks[index] >= 75 ? " · 达到数据上限" : ""}
            </p>
          )}
      </div>
      <div className={styles.controls}>
          {view === "weather" ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
              <label className="inline-flex min-h-8 items-center gap-2">
                <input type="checkbox" checked={clouds} onChange={event => setClouds(event.target.checked)} className="accent-[#2769a3]" />
                红外亮温 · 越深越冷
              </label>
              <label className="inline-flex min-h-8 items-center gap-2">
                <input type="checkbox" checked={precipitation} onChange={event => setPrecipitation(event.target.checked)} className="accent-[#e07534]" />
                降水柱高 · 0–75 mm/h
              </label>
            </div>
          ) : <p className={styles.description}>
            {replayViews[view].description}
            {view === "accumulation" && ` · 峰值约 ${accumulationPeak.toFixed(1)} mm`}
          </p>}
          {view === "rain" && (
            <svg className={styles.profile} viewBox="0 0 400 34" preserveAspectRatio="none" role="img" aria-label="全时段区域峰值降水率走势">
              <path d="M0 30 H400" className={styles.baseline} />
              <polyline points={peaks.map((peak, frame) => `${frame * 400 / final},${30 - peak / 75 * 24}`).join(" ")} className={styles.profileLine} />
              <line x1={index * 400 / final} x2={index * 400 / final} y1="0" y2="32" className={styles.playhead} />
            </svg>
          )}
          <div className="flex items-center gap-3 sm:gap-5">
            <button className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-teal-800 px-3 text-sm font-medium text-white hover:bg-teal-900"
              onClick={togglePlay}>
              {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {playing ? "暂停" : "播放"}
            </button>
            <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium tabular-nums">
              <span>{utcClock(timestamp)} UTC</span>
              <input type="range" min={0} max={final} value={index} aria-label="回放时间"
                aria-valuetext={`${utcClock(timestamp)} UTC`} className="h-6 w-full accent-teal-800"
                onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} />
            </label>
          </div>
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-300 tabular-nums" aria-live={playing ? "off" : "polite"}>
            {view === "weather" && satellite && (
              <a className="underline underline-offset-2" href="https://developers.google.cn/weathernext/guides/satweave">
                SatWeave · {utcClock(satellite.time)} UTC
              </a>
            )}
            <a className="underline underline-offset-2" href="https://developers.google.cn/weathernext/guides/pardig">
              PARDIG 降水估计 · {utcClock(timestamp)} UTC
            </a>
            <a className="underline underline-offset-2" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0 · Google DeepMind / Google Research</a>
          </p>
      </div>
    </>
  );
}
