import type { PowerMeasure, PowerPalette } from "./power-analysis";
import { resolveWorkspaceTopic, workspaceHref, type WorkspaceTopic } from "./globe-topics";
import { readReplayRegion, type ReplayRegionId } from "./weather-replay/regions";
import { replayViews, type WeatherScene } from "./weather-replay/views";

export type WorkspaceContext = {
  country?: string;
  year?: number;
  targetYear?: number;
  metric?: "gdp" | "perCapita" | "exports";
  scene?: "outlook" | "resources";
  region?: string;
  month?: string;
  date?: string;
  compareDate?: string;
  grid?: string;
  camera?: string;
  product?: string;
  version?: string;
  technology?: "wind" | "solar";
  sector?: string;
  projection?: "globe" | "map";
  weather?: string;
  replay?: Exclude<WeatherScene, "globe">;
  replayFrame?: number;
  replayPoint?: string;
  replayRegion?: ReplayRegionId;
  powerView?: "generation" | "facilities" | "capacity";
  powerPeriod?: "monthly" | "ytd";
  powerSource?: "ember" | "yearbook" | "nbs";
  powerMeasure?: PowerMeasure;
  powerPalette?: PowerPalette;
  powerReference?: string;
  powerPresentation?: "flat" | "split";
  powerPeers?: string;
  powerDemo?: "monthly";
  basemap?: string;
  layers?: string;
  tech?: string;
  labels?: string;
  minMw?: number;
};

type ContextUpdate = { [Key in keyof WorkspaceContext]?: WorkspaceContext[Key] | null };

function readYear(value: string | null) {
  return value && /^\d{4}$/.test(value) && Number(value) >= 1900 && Number(value) <= 2200 ? Number(value) : undefined;
}

function readDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function readId(value: string | null) {
  return value && /^[A-Za-z0-9_-]{1,48}$/.test(value) ? value : undefined;
}

function readList(value: string | null) {
  return value !== null && /^[A-Za-z0-9_,()-]{0,250}$/.test(value) ? value : undefined;
}

export function readWorkspaceContext(search: URLSearchParams): WorkspaceContext {
  const country = search.get("country");
  const metric = search.get("metric");
  const scene = search.get("scene");
  const month = search.get("month");
  const technology = search.get("technology");
  const projection = search.get("projection");
  const weather = search.get("weather");
  const replay = search.get("replay");
  const replayFrame = search.get("replayFrame");
  const powerView = search.get("powerView");
  const version = search.get("version");
  const powerPeriod = search.get("powerPeriod");
  const powerSource = search.get("powerSource");
  const powerMeasure = search.get("powerMeasure");
  const powerReference = search.get("powerReference");
  const powerPresentation = search.get("powerPresentation");
  const minMw = Number(search.get("minMw"));
  const grid = readGridPoint(search.get("grid"));
  const camera = readWorkspaceCamera(search.get("camera"));

  return {
    country: country && /^[A-Z]{3}$/.test(country) ? country : undefined,
    year: readYear(search.get("year")),
    targetYear: readYear(search.get("targetYear")),
    metric: metric === "gdp" || metric === "perCapita" || metric === "exports" ? metric : undefined,
    scene: scene === "outlook" || scene === "resources" ? scene : undefined,
    region: readId(search.get("region")),
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    date: readDate(search.get("date")),
    compareDate: readDate(search.get("compareDate")),
    grid: grid?.join(","),
    camera: camera ? [...camera.center, camera.zoom, camera.pitch, camera.bearing].join(",") : undefined,
    product: readId(search.get("product")),
    version: version && /^[a-f0-9]{64}$/.test(version) ? version : undefined,
    technology: technology === "wind" || technology === "solar" ? technology : undefined,
    sector: readId(search.get("sector")),
    projection: projection === "globe" || projection === "map" ? projection : undefined,
    weather: weather && /^[A-Za-z0-9_,./:@=+%-]{1,180}$/.test(weather) ? weather : undefined,
    replay: replay && Object.hasOwn(replayViews, replay) ? replay as keyof typeof replayViews : undefined,
    replayFrame: replayFrame && /^\d{1,4}$/.test(replayFrame) ? Number(replayFrame) : undefined,
    replayPoint: readGridPoint(search.get("replayPoint"))?.join(","),
    replayRegion: readReplayRegion(search.get("replayRegion")),
    powerView: powerView === "generation" || powerView === "capacity" || powerView === "facilities" ? powerView : undefined,
    powerPeriod: powerPeriod === "monthly" || powerPeriod === "ytd" ? powerPeriod : undefined,
    powerSource: powerSource === "ember" || powerSource === "yearbook" || powerSource === "nbs" ? powerSource : undefined,
    powerMeasure: powerMeasure === "growth" || powerMeasure === "change" || powerMeasure === "clean" || powerMeasure === "windsolar" ? powerMeasure : undefined,
    powerReference: powerReference && /^\d{4}(?:-(0[1-9]|1[0-2]))?$/.test(powerReference) ? powerReference : undefined,
    powerPalette: search.get("powerPalette") === "turbo" ? "turbo" : undefined,
    powerPresentation: powerPresentation === "flat" || powerPresentation === "split" ? powerPresentation : undefined,
    powerPeers: readList(search.get("powerPeers")),
    powerDemo: powerView === "generation" && search.get("powerDemo") === "monthly" ? "monthly" : undefined,
    basemap: readId(search.get("basemap")),
    layers: readList(search.get("layers")),
    tech: readList(search.get("tech")),
    labels: readId(search.get("labels")),
    minMw: Number.isFinite(minMw) && minMw > 0 ? minMw : undefined,
  };
}

export function readGridPoint(value: string | null | undefined): [number, number] | null {
  if (!value || !/^-?\d+(?:\.\d{1,4})?,-?\d+(?:\.\d{1,4})?$/.test(value)) return null;
  const [lng, lat] = value.split(",").map(Number);
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}

export function readWorkspaceCamera(value: string | null | undefined) {
  if (!value || !/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(value)) return null;
  const [lng, lat, zoom, pitch, bearing] = value.split(",").map(Number);
  if (![lng, lat, zoom, pitch, bearing].every(Number.isFinite) || Math.abs(lng) > 180 || Math.abs(lat) > 90
    || zoom < -2 || zoom > 24 || pitch < 0 || pitch > 85 || Math.abs(bearing) > 360) return null;
  return { center: [lng, lat] as [number, number], zoom, pitch, bearing };
}

function writeContext(search: URLSearchParams, values: ContextUpdate) {
  for (const [name, value] of Object.entries(values)) {
    if (value === null) search.delete(name);
    else if (value !== undefined) search.set(name, String(value));
  }
}

export function workspaceContextHref(topic: WorkspaceTopic, values: ContextUpdate = {}) {
  const search = new URLSearchParams(topic === "power" ? "" : "topic=" + topic);
  writeContext(search, values);
  const query = search.toString();
  return query ? "/workspace?" + query : "/workspace";
}

const storageKey = (topic: WorkspaceTopic) => "opengridworks:workspace:" + topic;

export function rememberWorkspace(topic: WorkspaceTopic) {
  if (window.location.pathname !== "/workspace" || resolveWorkspaceTopic(new URLSearchParams(window.location.search).get("topic")) !== topic) return;
  try {
    window.sessionStorage.setItem(storageKey(topic), window.location.search);
  } catch {
    // The current URL remains usable when storage is unavailable.
  }
}

export function recallWorkspace(topic: WorkspaceTopic) {
  try {
    const search = window.sessionStorage.getItem(storageKey(topic));
    return search ? readWorkspaceContext(new URLSearchParams(search)) : null;
  } catch {
    return null;
  }
}

export function lastWorkspaceHref(topic: WorkspaceTopic) {
  const context = recallWorkspace(topic);
  if (context) return workspaceContextHref(topic, context);
  const analysis = readWorkspaceContext(new URLSearchParams(window.location.search));
  if (topic === "economy") return workspaceContextHref(topic, {
    country: analysis.country, year: analysis.year, metric: analysis.metric,
  });
  if (topic === "power") return workspaceContextHref(topic, {
    region: analysis.region, year: analysis.year, month: analysis.month, product: analysis.product, version: analysis.version,
    powerView: analysis.month ? "generation" : undefined,
  });
  if (topic === "carbon") return workspaceContextHref(topic, { date: analysis.date });
  return workspaceHref(topic);
}

export function analysisContextHref(topic: string, context: ContextUpdate = {}, fragment = "") {
  const search = new URLSearchParams();
  writeContext(search, context);
  const query = search.toString();
  return "/visualization/" + topic + (query ? "?" + query : "") + (fragment ? "#" + fragment : "");
}

export function replaceWorkspaceContext(values: ContextUpdate) {
  if (window.location.pathname !== "/workspace") return;
  const url = new URL(window.location.href);
  writeContext(url.searchParams, values);
  if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  rememberWorkspace(resolveWorkspaceTopic(url.searchParams.get("topic")));
}
