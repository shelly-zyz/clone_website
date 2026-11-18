import type { WebGLRenderer } from "three";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayView } from "@/lib/weather-replay/views";
import type { ReplayArea } from "./replay-geography";
import type { Hotspot } from "./replay-data";

export type ViewState = {
  /** Screen areas covered by floating panels, in CSS pixels. */
  insets: { left: number; right: number; top: number; bottom: number };
  view: ReplayView;
  index: number;
  clouds: boolean;
  precipitation: boolean;
  cloudOpacity: number;
  sectionRow?: number;
  peakCell?: number;
  spots: readonly Hotspot[];
  trail: readonly Hotspot[];
  tracks: ReadonlyMap<number, Hotspot[]>;
  trackId?: number;
  hotspotThreshold: number;
  levels: readonly number[];
  totals?: readonly (number | null)[];
  accumulationStart?: number;
  accumulationLimit: number;
  rainLimit: number;
  selectedCell?: number;
};

export type SceneInput = { replay: WeatherReplay; area: ReplayArea; state: ViewState };

export type SurfaceSize = { width: number; height: number; ratio: number };

/** A view renderer draws into the shared surfaces. `render` returns true while it is animating. */
export interface ViewRenderer {
  update(input: SceneInput): void;
  render(now: number, size: SurfaceSize): boolean;
  pick(x: number, y: number): { cell: number; hotspot?: number } | undefined;
  zoom(factor: number): void;
  rotate?(angle: number): void;
  reset(): void;
  dispose(): void;
}

export type RendererContext = {
  /** Receives pointer input and holds labels; it sits above the WebGL canvas. */
  overlay: HTMLCanvasElement;
  gl: () => WebGLRenderer;
  invalidate: () => void;
  reducedMotion: () => boolean;
};

type Factory = (context: RendererContext) => Promise<ViewRenderer>;
const factories: Record<ReplayView, Factory> = {
  weather: context => import("./scene-volume").then(module => module.createVolumeScene(context)),
  time: context => import("./scene-stack").then(module => module.createStackScene(context)),
  rain: context => import("./scene-hotspots").then(module => module.createHotspotScene(context)),
  accumulation: context => import("./scene-isohyets").then(module => module.createIsohyetScene(context)),
};

export function createReplayScene(host: HTMLDivElement, onContextLoss: () => void,
  onPick?: (cell: number, hotspot: number | undefined, view: ReplayView) => void) {
  const glCanvas = document.createElement("canvas");
  const overlay = document.createElement("canvas");
  glCanvas.dataset.layer = "gl";
  overlay.dataset.layer = "overlay";
  host.append(glCanvas, overlay);
  if (!overlay.getContext("2d")) throw new Error("Weather canvas unavailable");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let renderer: WebGLRenderer | undefined;
  let glModule: typeof import("three") | undefined;
  let active: { view: ReplayView; renderer?: ViewRenderer; loading: Promise<void> } | undefined;
  let input: SceneInput | undefined;
  let requested = 0;
  let disposed = false;
  let tap: { x: number; y: number; id: number } | undefined;

  const context: RendererContext = {
    overlay,
    gl() {
      if (!renderer) {
        if (!glModule) throw new Error("three.js not loaded");
        renderer = new glModule.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = glModule.SRGBColorSpace;
        renderer.toneMapping = glModule.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
      }
      return renderer;
    },
    invalidate: redraw,
    reducedMotion: () => motion.matches,
  };

  function size(): SurfaceSize {
    const bounds = host.getBoundingClientRect();
    return { width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)), ratio: Math.min(window.devicePixelRatio || 1, 2) };
  }

  function draw(now: number) {
    requested = 0;
    if (disposed || document.hidden || !active?.renderer) return;
    const surface = size();
    const raster = [Math.round(surface.width * surface.ratio), Math.round(surface.height * surface.ratio)];
    if (overlay.width !== raster[0] || overlay.height !== raster[1]) {
      overlay.width = raster[0];
      overlay.height = raster[1];
    }
    const planar = active.view === "rain" || active.view === "accumulation";
    glCanvas.hidden = planar;
    if (!planar && renderer) {
      const glRatio = Math.min(surface.ratio, 1.6);
      if (renderer.getPixelRatio() !== glRatio) renderer.setPixelRatio(glRatio);
      const current = renderer.getSize(new (glModule!.Vector2)());
      if (current.x !== surface.width || current.y !== surface.height) renderer.setSize(surface.width, surface.height, false);
    }
    if (active.renderer.render(now, surface)) redraw();
  }

  function redraw() {
    if (!requested && !disposed && !document.hidden) requested = requestAnimationFrame(draw);
  }

  function activate(view: ReplayView) {
    if (active?.view === view) return;
    active?.renderer?.dispose();
    const entry: NonNullable<typeof active> = { view, loading: Promise.resolve() };
    active = entry;
    const planar = view === "rain" || view === "accumulation";
    entry.loading = (planar ? Promise.resolve() : import("three").then(module => { glModule = module; }))
      .then(() => factories[view](context))
      .then(next => {
        if (disposed || active !== entry) {
          next.dispose();
          return;
        }
        entry.renderer = next;
        if (input) next.update(input);
        redraw();
      })
      .catch(() => { if (active === entry && !disposed) onContextLoss(); });
  }

  function onDown(event: PointerEvent) {
    tap = event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : undefined;
  }
  function onMove(event: PointerEvent) {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 5) tap = undefined;
  }
  function onUp(event: PointerEvent) {
    if (tap?.id === event.pointerId && active?.renderer && input?.area.hasData) {
      const bounds = overlay.getBoundingClientRect();
      const picked = active.renderer.pick(event.clientX - bounds.left, event.clientY - bounds.top);
      if (picked) onPick?.(picked.cell, picked.hotspot, active.view);
    }
    tap = undefined;
  }
  const suppressMenu = (event: Event) => event.preventDefault();
  const onVisibility = () => redraw();
  const observer = new ResizeObserver(redraw);
  observer.observe(host);
  overlay.addEventListener("pointerdown", onDown);
  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onUp);
  overlay.addEventListener("contextmenu", suppressMenu);
  glCanvas.addEventListener("webglcontextlost", onContextLoss);
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", redraw);

  return {
    update(replay: WeatherReplay, area: ReplayArea, state: ViewState) {
      input = { replay, area, state };
      activate(state.view);
      active?.renderer?.update(input);
      redraw();
    },
    rotate(angle: number) { active?.renderer?.rotate?.(angle); redraw(); },
    zoom(factor: number) { active?.renderer?.zoom(factor); redraw(); },
    reset() { active?.renderer?.reset(); redraw(); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(requested);
      active?.renderer?.dispose();
      renderer?.dispose();
      observer.disconnect();
      overlay.removeEventListener("pointerdown", onDown);
      overlay.removeEventListener("pointermove", onMove);
      overlay.removeEventListener("pointerup", onUp);
      overlay.removeEventListener("contextmenu", suppressMenu);
      glCanvas.removeEventListener("webglcontextlost", onContextLoss);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", redraw);
      glCanvas.remove();
      overlay.remove();
    },
  };
}
