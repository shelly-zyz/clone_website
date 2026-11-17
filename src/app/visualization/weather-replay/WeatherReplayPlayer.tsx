"use client";

import { Compass, Maximize2, Minimize2, Minus, Pause, Play, Plus, Rotate3D, Scan } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GlobeLoading } from "@/components/opengridworks/GlobeLoading";
import { WorkspaceFilterSelect } from "@/components/opengridworks/WorkspaceSidebar";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { readReplayRegion, regionalReplay, replayRegionOptions, type ReplayRegionId } from "@/lib/weather-replay/regions";
import { updateAnalysisQuery, useAnalysisQuery } from "../useAnalysisLocation";
import { replayViewOrder, replayViews, type ReplayView } from "@/lib/weather-replay/views";
import { createReplayScene } from "./replay-canvas";
import { ReplayReadings } from "./ReplayReadings";
import { accumulateRain, accumulationStart, areaStats, cellAreas, maxContinuousAccumulation, satelliteAt, stackFrameIndices, trackHotspots, utcClock, utcStamp } from "./replay-data";
import { gridCoordinate, prepareReplayArea, regionalPeak, type ReplayGeography } from "./replay-geography";
import { loadWeatherReplayData } from "./replay-loader";
import { accumulationScale, rainScale } from "./replay-palette";
import styles from "./player.module.css";

type ReplayRequest = { query: string; replay: WeatherReplay; geography: ReplayGeography; localArchive: boolean } | { query: string; error: string };

export function WeatherReplayPlayer({ query, scene, region, initialFrame, initialPoint, onFrameChange, onPointChange }: {
  query: string;
  scene?: ReplayView;
  region?: ReplayRegionId;
  initialFrame?: number;
  initialPoint?: [number, number];
  onFrameChange?: (frame: number) => void;
  onPointChange?: (point: [number, number]) => void;
}) {
  const [selectedView, setSelectedView] = useState<ReplayView>("weather");
  const view = scene ?? selectedView;
  const embedded = scene !== undefined;
  const location = useAnalysisQuery(region ? "region=" + region : "");
  const regionId = (embedded ? region : readReplayRegion(location.get("region"))) ?? "archive";
  const bundled = query ? undefined : regionalReplay(regionId);
  const caseQuery = bundled ? "id=" + bundled.archive : query;
  const requestKey = caseQuery + "|" + regionId;
  const useGlobalGeography = !!bundled || new URLSearchParams(query).get("id")?.startsWith("gfs-") === true;
  const [response, setResponse] = useState<ReplayRequest>();
  const [attempt, setAttempt] = useState(0);
  const current = response?.query === requestKey ? response : undefined;

  useEffect(() => {
    let current = true;
    void loadWeatherReplayData(caseQuery, useGlobalGeography).then(data => {
      if (current) setResponse({ query: requestKey, ...data });
    }).catch(error => {
      if (current) setResponse({ query: requestKey, error: error instanceof Error ? error.message : "区域回放加载失败。" });
    });
    return () => { current = false; };
  }, [attempt, caseQuery, requestKey, useGlobalGeography]);

  return (
    <section className={embedded ? styles.embedded : styles.standalone} aria-label="区域气象回放">
      {!embedded && (
        <div className={styles.standaloneHeading}>
          <h1>区域气象回放</h1>
          <WorkspaceFilterSelect label="回放区域" value={regionId} options={replayRegionOptions}
            onChange={value => updateAnalysisQuery({ region: readReplayRegion(value) })} />
        </div>
      )}
      {current && "replay" in current ? (
        <ReplayControls key={requestKey} replay={current.replay} geography={current.geography} region={regionId} view={view}
          initialFrame={initialFrame} initialPoint={initialPoint} onPointChange={onPointChange} localArchive={current.localArchive} onFrameChange={onFrameChange} onViewChange={embedded ? undefined : setSelectedView} />
      ) : current ? (
        <div className={styles.loadState}>
          <p role="alert">{current.error}</p>
          <button className={styles.button} onClick={() => { setResponse(undefined); setAttempt(value => value + 1); }}>重试</button>
        </div>
      ) : embedded ? <GlobeLoading label="正在加载区域天气回放" />
        : <p className={styles.loadState} role="status">正在加载区域边界、云图和降水帧…</p>}
    </section>
  );
}

function ReplayControls({ replay, geography, region, view, onViewChange, initialFrame, localArchive, initialPoint, onPointChange, onFrameChange }: {
  replay: WeatherReplay;
  geography: ReplayGeography;
  region: ReplayRegionId;
  view: ReplayView;
  localArchive: boolean;
  onViewChange?: (view: ReplayView) => void;
  initialFrame?: number;
  initialPoint?: [number, number];
  onPointChange?: (point: [number, number]) => void;
  onFrameChange?: (frame: number) => void;
}) {
  const legendId = useId();
  const final = replay.rain.length - 1;
  const [playing, setPlaying] = useState(false);
  const { west, east, south, north } = replay.bounds;
  const initialCell = initialPoint && initialPoint[0] >= west && initialPoint[0] <= east && initialPoint[1] >= south && initialPoint[1] <= north
    ? Math.round((initialPoint[0] - west) / (east - west) * (replay.cols - 1))
      + Math.round((initialPoint[1] - south) / (north - south) * (replay.rows - 1)) * replay.cols : undefined;
  const [point, setPoint] = useState(initialCell);
  const [sourceCell, setSourceCell] = useState(initialCell);
  if (sourceCell !== initialCell) {
    setSourceCell(initialCell);
    setPoint(initialCell);
  }
  const [trackId, setTrackId] = useState<number>();
  const [clouds, setClouds] = useState(true);
  const [cloudOpacity, setCloudOpacity] = useState(65);
  const [section, setSection] = useState(true);
  const [transect, setTransect] = useState<number>();
  const [immersive, setImmersive] = useState(false);
  const [precipitation, setPrecipitation] = useState(false);
  const [windowHours, setWindowHours] = useState(0);
  const selectedCell = point;
  const sectionRow = view === "weather" && section ? transect ?? (point === undefined ? Math.floor(replay.rows / 2) : Math.floor(point / replay.cols)) : undefined;
  const planView = view === "rain" || view === "accumulation";
  const [sourceFrame, setSourceFrame] = useState(initialFrame);
  const [index, setIndex] = useState(Math.min(initialFrame ?? (replay.metadata ? 2 : 8), final));
  if (sourceFrame !== initialFrame) {
    setSourceFrame(initialFrame);
    const restored = Math.min(initialFrame ?? (replay.metadata ? 2 : 8), final);
    if (index !== restored) {
      setIndex(restored);
      setPlaying(false);
    }
  }

  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createReplayScene>>(null);
  const [drawingFailed, setDrawingFailed] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const area = useMemo(() => prepareReplayArea(replay, region, geography), [geography, region, replay]);
  const peaks = useMemo(() => replay.rain.map(frame => regionalPeak(frame.values, area.cells)), [replay, area]);
  const timestamp = replay.rain[index].time;
  const satellite = satelliteAt(replay, timestamp);
  const currentPeak = peaks[index];
  const weights = useMemo(() => cellAreas(replay), [replay]);
  const hotspotThreshold = 2.5;
  const tracking = useMemo(() => trackHotspots(replay, weights, hotspotThreshold), [replay, weights]);
  const spots = tracking.frames[index];
  const activeSpot = trackId === undefined
    ? spots.find(spot => selectedCell !== undefined && spot.cells.includes(selectedCell)) ?? spots[0]
    : spots.find(spot => spot.id === trackId);
  const track = tracking.tracks.get(trackId ?? activeSpot?.id ?? -1) ?? [];
  const slices = stackFrameIndices(replay, index);
  const trail = view === "time" ? track : view === "rain" ? track.filter(spot => spot.frame <= index) : [];
  const availableWindows = useMemo(() => [6, 12, 24].filter(hours =>
    replay.rain.some((_, frame) => accumulationStart(replay, frame, hours) !== undefined)), [replay]);
  const start = view === "accumulation" ? accumulationStart(replay, index, windowHours) : undefined;
  const accumulated = useMemo(() => start === undefined ? [] : accumulateRain(replay, start), [replay, start]);
  const totals = start === undefined ? undefined : accumulated[index - start];
  const accumulationPeak = totals ? regionalPeak(totals, area.cells) : null;
  // Keep a common scale while moving across time or changing the window.
  const accumulationLimit = useMemo(() => Math.max(10, Math.ceil(maxContinuousAccumulation(replay) / 10) * 10), [replay]);
  const levels = accumulationLimit >= 60 ? [5, 25, 50] : [1, 5, 10];
  const accumulationStats = totals ? areaStats(totals, weights, levels) : undefined;
  const peakCell = view === "accumulation" && accumulationPeak ? accumulationStats?.peakCell : undefined;
  const legendStops = view === "accumulation" ? accumulationScale : rainScale;
  const forecast = replay.metadata;
  const rainLimit = forecast ? Math.max(5, Math.ceil(Math.max(0, ...peaks.map(peak => peak ?? 0)) / 5) * 5) : 75;
  const legendMax = view === "accumulation" ? accumulationLimit : rainLimit;
  const legendStopMax = legendStops[legendStops.length - 1][0];

  useEffect(() => {
    if (!canvas.current) return;
    let fail = 0;
    try {
      renderer.current = createReplayScene(canvas.current, () => setDrawingFailed(true), (cell, hotspot, pickedView) => {
        setPoint(cell);
        if (pickedView === "weather") setTransect(undefined);
        if (pickedView === "rain") setTrackId(hotspot);
        onPointChange?.(gridCoordinate(replay, cell % replay.cols, Math.floor(cell / replay.cols)));
      });
    } catch {
      fail = requestAnimationFrame(() => setDrawingFailed(true));
    }
    return () => {
      cancelAnimationFrame(fail);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [onPointChange, renderAttempt, replay]);

  useEffect(() => {
    renderer.current?.update(replay, area, { view, index, clouds, cloudOpacity: cloudOpacity / 100, sectionRow, peakCell, precipitation, totals, accumulationLimit, rainLimit, selectedCell, spots, trail, hotspotThreshold, levels });
  });

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

  useEffect(() => {
    if (!immersive) return;
    // Leaving browser fullscreen (Esc or the system control) also leaves the immersive layout.
    const onFullscreen = () => { if (!document.fullscreenElement) setImmersive(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setImmersive(false); };
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKey);
    };
  }, [immersive]);

  function toggleImmersive() {
    if (immersive) {
      setImmersive(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    setImmersive(true);
    const shell = canvas.current?.closest("main") ?? document.documentElement;
    if (!document.fullscreenElement && shell.requestFullscreen) void shell.requestFullscreen().catch(() => undefined);
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
    } else {
      if (view === "rain" && activeSpot) setTrackId(activeSpot.id);
      if (index >= final) {
        setIndex(0);
        onFrameChange?.(0);
      }
      setPlaying(true);
    }
  }

  const displayPeak = view === "accumulation" ? accumulationPeak : currentPeak;
  const unit = view === "accumulation" ? "mm" : "mm/h";
  const showsRainParticles = view === "weather" && precipitation;
  const missing = !area.hasData ? "该区域暂无已发布的云雨回放。"
    : displayPeak === null ? view === "accumulation" ? "当前时刻缺少所选时段的连续降水数据。" : "当前降水帧缺测。" : "";
  function selectFrame(frame: number) {
    setPlaying(false);
    setIndex(frame);
    onFrameChange?.(frame);
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2>{replayViews[view].title}</h2>
          <p>{area.label}{area.hasData && " · " + timestamp.slice(0, 10)}</p>
        </div>
        <div className={styles.cameraControls} role="group" aria-label="地图视角">
          {!planView && <button className={styles.button} type="button" title="旋转视角" aria-label="旋转视角" onClick={() => renderer.current?.rotate(Math.PI / 3)}>
            <Rotate3D size={16} aria-hidden="true" />
          </button>}
          <button className={styles.button} type="button" title="缩小" aria-label="缩小" onClick={() => renderer.current?.zoom(1 / 1.2)}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" title="放大" aria-label="放大" onClick={() => renderer.current?.zoom(1.2)}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" title="重置视角" aria-label="重置视角" onClick={() => renderer.current?.reset()}>
            <Scan size={15} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" aria-pressed={immersive}
            title={immersive ? "退出沉浸" : "沉浸全屏"} aria-label={immersive ? "退出沉浸" : "沉浸全屏"} onClick={toggleImmersive}>
            {immersive ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
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
      <div className={styles.scene} data-immersive={immersive}>
        <div className={styles.stage} data-view={view}>
          <canvas ref={canvas} role="img" aria-label={area.label + " · " + replayViews[view].description} className={styles.canvas} />
          {area.hasData && (
            <div className={styles.stageLabels}>
              <span className={styles.sceneTime}><Compass size={13} aria-hidden="true" /> {utcClock(timestamp)} UTC</span>
              {view === "time" && <span>竖轴 · UTC 时间</span>}
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
              <div className={styles.legendRamp} role="img" aria-label={`${unit}，0 至 ${legendMax}`}>
                  <svg className={styles.legendScale} aria-hidden="true" focusable="false">
                    <defs>
                      <linearGradient id={legendId} x1="0" x2="0" y1="1" y2="0">
                        {legendStops.map(([value, color]) => (
                          <stop key={value} offset={value / legendStopMax} stopColor={`rgb(${color.join(",")})`} />
                        ))}
                      </linearGradient>
                    </defs>
                    <rect width="100%" height="100%" rx="3" fill={`url(#${legendId})`} />
                  </svg>
                  <span className={styles.legendValues}><span>{legendMax}</span><span>{legendMax / 2}</span><span>0</span></span>
              </div>
              {view === "time" && displayPeak !== null && (
                <span className={styles.peak}>区域峰值 <strong>{displayPeak.toFixed(1)}</strong> {unit}
                  {!forecast && displayPeak >= 75 && " · PARDIG 档案上限"}
                </span>
              )}
            </div>
          )}
        </div>
        {area.hasData && <ReplayReadings replay={replay} view={view} frame={index} cell={selectedCell}
          peaks={peaks} totals={accumulated} accumulationStart={start} accumulationStats={accumulationStats}
          levels={levels} weights={weights} limit={legendMax} sectionRow={sectionRow} slices={slices}
          satellite={clouds ? satellite : undefined} spots={spots} track={track} trackId={trackId ?? activeSpot?.id}
          threshold={hotspotThreshold} onTrack={setTrackId} onFrame={selectFrame} />}

      </div>
      {area.hasData && (
        <div className={styles.controls}>
          {view === "weather" && (
            <div className={styles.layers} role="group" aria-label="云雨结构图层">
              <label><input type="checkbox" checked={clouds} onChange={event => setClouds(event.target.checked)} /> 云体示意</label>
              <label><input type="checkbox" checked={precipitation} onChange={event => setPrecipitation(event.target.checked)} /> 降雨粒子</label>
              <label><input type="checkbox" checked={section} onChange={event => setSection(event.target.checked)} /> 垂直剖面</label>
              <label>云体不透明度 <input type="range" min={10} max={100} value={cloudOpacity} disabled={!clouds}
                aria-valuetext={cloudOpacity + "%"} onChange={event => setCloudOpacity(Number(event.target.value))} /></label>
              {sectionRow !== undefined && <label>剖线纬度 <input type="range" min={0} max={replay.rows - 1} value={sectionRow}
                aria-valuetext={(south + sectionRow / (replay.rows - 1) * (north - south)).toFixed(2) + "°"}
                onChange={event => setTransect(Number(event.target.value))} /></label>}
            </div>
          )}
          {view === "accumulation" && <div className={styles.layers}>
            <label>累计时段 <select value={windowHours} onChange={event => {
              const hours = Number(event.target.value);
              setWindowHours(hours);
              if (accumulationStart(replay, index, hours) === undefined) {
                const next = replay.rain.findIndex((_, frame) => frame >= index && accumulationStart(replay, frame, hours) !== undefined);
                selectFrame(next >= 0 ? next : replay.rain.findLastIndex((_, frame) => accumulationStart(replay, frame, hours) !== undefined));
              }
            }}>
              <option value={0}>档案起点至当前</option>
              {availableWindows.map(hours => <option key={hours} value={hours}>过去 {hours} 小时</option>)}
            </select></label>
            {start !== undefined && <span>{utcStamp(replay.rain[start].time)} → {utcStamp(timestamp)} UTC</span>}
          </div>}
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
                onChange={event => selectFrame(Number(event.target.value))} />
            </label>
          </div>
          <p className={styles.sources}>
            {!forecast && view === "weather" && clouds && satellite && (
              <a href="https://developers.google.cn/weathernext/guides/satweave">SatWeave · {utcClock(satellite.time)} UTC</a>
            )}
            {view === "weather" && clouds && (!satellite || regionalPeak(satellite.values, area.cells) === null) && <span>当前区域云场缺测</span>}
            {forecast ? (
              <><a href={replay.rain[index].url}>{forecast.product} · 历史模式预报</a><span>起报 {forecast.run.slice(0, 10)} {utcClock(forecast.run)} UTC · {forecast.resolution}°</span></>
            ) : <a href="https://developers.google.cn/weathernext/guides/pardig">PARDIG-NRT · {utcClock(timestamp)} UTC</a>}
            <span>{localArchive ? "内置历史档案" : "历史回放"}</span>
          </p>
        </div>
      )}
    </>
  );
}
