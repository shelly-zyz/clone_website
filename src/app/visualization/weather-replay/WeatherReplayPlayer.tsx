"use client";

import { CloudRain, Layers3, Pause, Play, Rotate3D } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { paintReplay, utcClock, type ReplayView } from "./replay-canvas";

const control = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-800 hover:bg-slate-200";
const selected = "aria-pressed:bg-teal-800 aria-pressed:text-white";

export function WeatherReplayPlayer({ query }: { query: string }) {
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
    <section className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">区域风暴 3D 回放</h1>
      {replay ? <ReplayControls key={query} replay={replay} /> : failure ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p role="alert">{failure}</p>
          <button className={control} onClick={() => { setFailure(""); setAttempt(value => value + 1); }}>重试</button>
        </div>
      ) : <p className="mt-3 text-sm text-slate-600" role="status">正在加载云图和降水帧…</p>}
    </section>
  );
}

function ReplayControls({ replay }: { replay: WeatherReplay }) {
  const [view, setView] = useState<ReplayView>("weather");
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
    const animate = playing && previous !== index && view === "weather" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const started = performance.now();
    let pending = 0;
    const draw = (now: number) => {
      const progress = animate ? Math.min(1, (now - started) / 240) : 1;
      paintReplay(canvas, replay, { index, view, rotation, clouds, precipitation, previous, progress });
      if (progress < 1) pending = requestAnimationFrame(draw);
    };
    pending = requestAnimationFrame(draw);
    const size = new ResizeObserver(() => {
      paintReplay(canvas, replay, { index, view, rotation, clouds, precipitation, previous: index, progress: 1 });
    });
    size.observe(canvas);
    return () => { cancelAnimationFrame(pending); size.disconnect(); };
  }, [clouds, index, playing, precipitation, replay, rotation, view]);

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
      <p className="mt-2 text-sm text-slate-600">
        {replay.region} · {timestamp.slice(0, 10)} UTC · {utcClock(replay.rain[0].time)}–{utcClock(replay.rain[final].time)}
      </p>
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div role="group" aria-label="回放视图" className="flex flex-wrap gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-5">
          <button className={`${control} ${selected}`} aria-pressed={view === "weather"} onClick={() => setView("weather")}>
            <CloudRain size={17} aria-hidden="true" /> 云雨叠加
          </button>
          <button className={`${control} ${selected}`} aria-pressed={view === "time"} onClick={() => setView("time")}>
            <Layers3 size={17} aria-hidden="true" /> 降水时空层
          </button>
          <button className={`${control} sm:ml-auto`} onClick={() => setRotation(value => (value + 1) % 4)}>
            <Rotate3D size={17} aria-hidden="true" /> 旋转视角
          </button>
        </div>
        <canvas ref={canvasRef} role="img"
          aria-label={view === "weather" ? "红外云图和按降水强度升高的三维柱" : "每隔半小时一层的降水率，向上为较晚时刻"}
          className="block h-[clamp(15rem,54vw,30rem)] w-full bg-slate-50" />
        <div className="grid gap-3 border-t border-slate-200 px-3 py-3 sm:px-5">
          {view === "weather" ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
              <label className="inline-flex min-h-8 items-center gap-2">
                <input type="checkbox" checked={clouds} onChange={event => setClouds(event.target.checked)} className="accent-[#2769a3]" />
                红外亮温 · 越深越冷
              </label>
              <label className="inline-flex min-h-8 items-center gap-2">
                <input type="checkbox" checked={precipitation} onChange={event => setPrecipitation(event.target.checked)} className="accent-[#e07534]" />
                降水柱高 · 0–75 mm/h
              </label>
            </div>
          ) : <p className="text-sm text-slate-700">每层间隔 30 分钟 · 颜色越深，降水率越高（mm/h）</p>}
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
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600 tabular-nums" aria-live={playing ? "off" : "polite"}>
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
      </div>
    </>
  );
}
