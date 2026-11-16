"use client";

import { Compass, Minus, Pause, Play, Plus, Rotate3D, Scan } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceFilterSelect } from "@/components/opengridworks/WorkspaceSidebar";
import { finishGlobeHandoff } from "@/lib/globe-handoff";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { readReplayRegion, replayRegionOptions, type ReplayRegionId } from "@/lib/weather-replay/regions";
import { updateAnalysisQuery, useAnalysisQuery } from "../useAnalysisLocation";
import { replayViewOrder, replayViews, type ReplayView } from "@/lib/weather-replay/views";
import { createReplayScene } from "./replay-canvas";
import { accumulateRain, satelliteAt, utcClock } from "./replay-data";
import { prepareReplayArea, regionalPeak, type ReplayGeography } from "./replay-geography";
import { loadWeatherReplayData } from "./replay-loader";
import styles from "./player.module.css";

type ReplayRequest = { query: string; replay: WeatherReplay; geography: ReplayGeography } | { query: string; error: string };

export function WeatherReplayPlayer({ query, scene, region, initialFrame, onFrameChange }: {
  query: string;
  scene?: ReplayView;
  region?: ReplayRegionId;
  initialFrame?: number;
  onFrameChange?: (frame: number) => void;
}) {
  const [selectedView, setSelectedView] = useState<ReplayView>("weather");
  const view = scene ?? selectedView;
  const embedded = scene !== undefined;
  const location = useAnalysisQuery(region ? "region=" + region : "");
  const regionId = (embedded ? region : readReplayRegion(location.get("region"))) ?? "archive";
  const [response, setResponse] = useState<ReplayRequest>();
  const [attempt, setAttempt] = useState(0);
  const current = response?.query === query ? response : undefined;

  useEffect(() => {
    let current = true;
    void loadWeatherReplayData(query).then(data => {
      if (current) setResponse({ query, ...data });
    }).catch(error => {
      if (current) setResponse({ query, error: error instanceof Error ? error.message : "区域回放加载失败。" });
    });
    return () => { current = false; };
  }, [attempt, query]);

  useEffect(() => {
    if (!embedded || !current) return;
    const frame = requestAnimationFrame(() => finishGlobeHandoff("weather"));
    return () => cancelAnimationFrame(frame);
  }, [current, embedded]);

  return (
    <section className={embedded ? styles.embedded : styles.standalone} aria-label="区域风暴 3D 回放">
      {!embedded && (
        <div className={styles.standaloneHeading}>
          <h1>区域风暴 3D 回放</h1>
          <WorkspaceFilterSelect label="回放区域" value={regionId} options={replayRegionOptions}
            onChange={value => updateAnalysisQuery({ region: readReplayRegion(value) })} />
        </div>
      )}
      {current && "replay" in current ? (
        <ReplayControls key={query} replay={current.replay} geography={current.geography} region={regionId} view={view}
          initialFrame={initialFrame} onFrameChange={onFrameChange} onViewChange={embedded ? undefined : setSelectedView} />
      ) : current ? (
        <div className={styles.loadState}>
          <p role="alert">{current.error}</p>
          <button className={styles.button} onClick={() => { setResponse(undefined); setAttempt(value => value + 1); }}>重试</button>
        </div>
      ) : <p className={styles.loadState} role="status">正在加载区域边界、云图和降水帧…</p>}
    </section>
  );
}

function ReplayControls({ replay, geography, region, view, onViewChange, initialFrame, onFrameChange }: {
  replay: WeatherReplay;
  geography: ReplayGeography;
  region: ReplayRegionId;
  view: ReplayView;
  onViewChange?: (view: ReplayView) => void;
  initialFrame?: number;
  onFrameChange?: (frame: number) => void;
}) {
  const final = replay.rain.length - 1;
  const [playing, setPlaying] = useState(false);
  const [clouds, setClouds] = useState(true);
  const [precipitation, setPrecipitation] = useState(true);
  const [sourceFrame, setSourceFrame] = useState(initialFrame);
  const [index, setIndex] = useState(Math.min(initialFrame ?? 8, final));
  if (sourceFrame !== initialFrame) {
    setSourceFrame(initialFrame);
    const restored = Math.min(initialFrame ?? 8, final);
    if (index !== restored) {
      setIndex(restored);
      setPlaying(false);
    }
  }

  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<typeof createReplayScene>>(null);
  const [drawingFailed, setDrawingFailed] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const area = useMemo(() => prepareReplayArea(replay, region, geography), [geography, region, replay]);
  const peaks = useMemo(() => replay.rain.map(frame => regionalPeak(frame.values, area.cells)), [replay, area]);
  const timestamp = replay.rain[index].time;
  const satellite = satelliteAt(replay, timestamp);
  const currentPeak = peaks[index];
  const accumulated = useMemo(() => accumulateRain(replay), [replay]);
  const totals = area.hasData && view === "accumulation" ? accumulated[index] : undefined;
  const accumulationPeak = totals ? regionalPeak(totals, area.cells) : null;
  const accumulationLimit = Math.max(1, accumulationPeak ?? 0);

  useEffect(() => {
    if (!canvas.current || !overlay.current) return;
    let fail = 0;
    try {
      renderer.current = createReplayScene(canvas.current, overlay.current, () => setDrawingFailed(true));
    } catch {
      fail = requestAnimationFrame(() => setDrawingFailed(true));
    }
    return () => {
      cancelAnimationFrame(fail);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [renderAttempt]);

  useEffect(() => {
    renderer.current?.update(replay, area, { view, index, clouds, precipitation, totals, accumulationLimit });
  }, [accumulationLimit, area, clouds, index, precipitation, renderAttempt, replay, totals, view]);

  useEffect(() => {
    if (!playing || !area.hasData) return;
    const timer = window.setTimeout(() => {
      if (document.hidden) {
        setPlaying(false);
        return;
      }
      const next = Math.min(index + 1, final);
      setIndex(next);
      onFrameChange?.(next);
      if (next >= final) setPlaying(false);
    }, 530);
    return () => window.clearTimeout(timer);
  }, [area.hasData, final, index, onFrameChange, playing]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
    } else {
      if (index >= final) {
        setIndex(0);
        onFrameChange?.(0);
      }
      setPlaying(true);
    }
  }

  const displayPeak = view === "accumulation" ? accumulationPeak : currentPeak;
  const unit = view === "accumulation" ? "mm" : "mm/h";
  const showsRainParticles = view === "rain" || (view === "weather" && precipitation);
  const missing = !area.hasData ? "该区域暂无已发布的云雨回放。"
    : displayPeak === null ? view === "accumulation" ? "所选窗口缺测，无法计算累计降水。" : "当前降水帧缺测。" : "";
  const track = peaks.map((peak, frame) => peak === null ? "" :
    (frame > 0 && peaks[frame - 1] !== null ? "L" : "M") + frame * 400 / Math.max(1, final) + " " + (27 - peak / 75 * 24)).join(" ");

  return (
    <>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2>{replayViews[view].title}</h2>
          <p>{area.label}{area.hasData && " · " + timestamp.slice(0, 10)}</p>
        </div>
        <div className={styles.cameraControls} role="group" aria-label="三维视角">
          <button className={styles.button} type="button" title="旋转视角" aria-label="旋转视角" onClick={() => renderer.current?.rotate(Math.PI / 3)}>
            <Rotate3D size={16} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" title="缩小" aria-label="缩小" onClick={() => renderer.current?.zoom(1 / 1.2)}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" title="放大" aria-label="放大" onClick={() => renderer.current?.zoom(1.2)}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" title="重置视角" aria-label="重置视角" onClick={() => renderer.current?.reset()}>
            <Scan size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      {onViewChange && (
        <div role="group" aria-label="回放视图" className={styles.standaloneViews}>
          {replayViewOrder.map(item => (
            <button key={item} type="button" className={styles.button} aria-pressed={view === item} onClick={() => onViewChange(item)}>
              {replayViews[item].title}
            </button>
          ))}
        </div>
      )}
      <div className={styles.stage} data-view={view}>
        <canvas ref={canvas} role="img" aria-label={area.label + " · " + replayViews[view].description} className={styles.canvas} />
        <div ref={overlay} className={styles.mapLabels} aria-hidden="true" />
        {area.hasData && (
          <div className={styles.stageLabels}>
            <span className={styles.sceneTime}><Compass size={13} aria-hidden="true" /> {utcClock(timestamp)} UTC</span>
            {view === "time" && <span>时间切片 · UTC</span>}
            {showsRainParticles && <span>粒子密度 · 降水率</span>}
          </div>
        )}
        {drawingFailed ? (
          <div className={styles.emptyNotice} role="alert">
            当前浏览器无法绘制回放场景。
            <button className={styles.button} onClick={() => { setDrawingFailed(false); setRenderAttempt(value => value + 1); }}>重新绘制</button>
          </div>
        ) : missing ? <p role="status" className={styles.emptyNotice}>{missing}</p> : null}
        {area.hasData && (
          <div className={styles.legend}>
            <span>{view === "accumulation" ? "累计降水" : "降水率"} · {unit}</span>
            {(view === "time" || view === "accumulation") && (
              <>
                <span className={styles.legendScale} aria-hidden="true" />
                <span className={styles.legendValues}><span>0</span><span>{view === "accumulation" ? accumulationLimit : 75}</span></span>
              </>
            )}
            {displayPeak !== null && (
              <span className={styles.peak}>区域峰值 <strong>{displayPeak.toFixed(1)}</strong> {unit}
                {view !== "accumulation" && displayPeak >= 75 && " · 达到数据上限"}
                {view === "rain" && displayPeak === 0 && " · 无降水"}</span>
            )}
          </div>
        )}
      </div>
      {area.hasData && (
        <div className={styles.controls}>
          {view === "weather" && (
            <div className={styles.layers}>
              <label><input type="checkbox" checked={clouds} onChange={event => setClouds(event.target.checked)} /> 红外亮温（K）· 越亮越冷</label>
              <label><input type="checkbox" checked={precipitation} onChange={event => setPrecipitation(event.target.checked)} /> 降水强度</label>
            </div>
          )}
          {view === "accumulation" && <p className={styles.description}>自 {utcClock(replay.rain[0].time)} UTC 积分 · mm</p>}
          {view === "rain" && (
            <div className={styles.profileRow}>
              <span>区域峰值走势</span>
              <svg className={styles.profile} viewBox="0 0 400 30" preserveAspectRatio="none" role="img" aria-label="全时段区域峰值降水率走势">
                <path d="M0 27 H400" className={styles.baseline} />
                <path d={track} className={styles.profileLine} />
                <line x1={index * 400 / Math.max(1, final)} x2={index * 400 / Math.max(1, final)} y1="0" y2="30" className={styles.playhead} />
              </svg>
            </div>
          )}
          <div className="flex items-center gap-3 sm:gap-5">
            <button className={styles.playButton} type="button" onClick={togglePlay} disabled={final === 0}>
              {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {playing ? "暂停" : "播放"}
            </button>
            <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium tabular-nums">
              <span className={styles.timelineTimes}>
                <span>{utcClock(replay.rain[0].time)}</span>
                <strong>{utcClock(timestamp)} UTC</strong>
                <span>{utcClock(replay.rain[final].time)}</span>
              </span>
              <input type="range" min={0} max={final} value={index} aria-label="回放时间"
                aria-valuetext={utcClock(timestamp) + " UTC"} className={styles.timelineInput}
                onChange={event => {
                  const frame = Number(event.target.value);
                  setPlaying(false);
                  setIndex(frame);
                  onFrameChange?.(frame);
                }} />
            </label>
          </div>
          <p className={styles.sources}>
            {view === "weather" && clouds && satellite && (
              <a href="https://developers.google.cn/weathernext/guides/satweave">SatWeave · {utcClock(satellite.time)} UTC</a>
            )}
            {view === "weather" && clouds && (!satellite || regionalPeak(satellite.values, area.cells) === null) && <span>当前区域红外缺测</span>}
            <a href="https://developers.google.cn/weathernext/guides/pardig">PARDIG-NRT · {utcClock(timestamp)} UTC</a>
            <span>{area.ocean ? "含沿海与海上网格 · " : "国家覆盖范围 · "}历史回放</span>
          </p>
        </div>
      )}
    </>
  );
}
