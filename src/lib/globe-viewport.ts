import type { Map } from "maplibre-gl";

export type MapOverview = "globe" | "atlas" | "china";

export const carbonAtlasCenter: [number, number] = [0, 19];

function fittingSize(container: HTMLElement, atlas: boolean) {
  const { clientWidth: width, clientHeight: height } = container;
  // In Mercator the inhabited latitudes occupy roughly 70% of a world tile.
  return atlas ? Math.min(width * 0.95, height / 0.72) : Math.min(width, height);
}

export function overviewZoom(container: HTMLElement, overview: MapOverview, latitude: number) {
  const size = Math.max(1, fittingSize(container, overview === "atlas"));
  if (overview === "atlas") return Math.max(-2, Math.min(1.55, Math.log2(size / 512)));
  if (overview === "china") return Math.max(-2, Math.min(3.35, Math.log2(size / 106)));
  const latitudeScale = Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  return Math.max(-2, Math.log2(size * 0.84 * latitudeScale / 140));
}

export function observeMapViewport(map: Map, isAtlas = () => false) {
  const container = map.getContainer();
  let previous = { width: container.clientWidth, height: container.clientHeight };
  const observer = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height || (width === previous.width && height === previous.height)) return;
    const atlas = isAtlas();
    const before = atlas ? Math.min(previous.width * 0.95, previous.height / 0.72) : Math.min(previous.width, previous.height);
    const after = fittingSize(container, atlas);
    const zoom = map.getZoom();
    previous = { width, height };
    map.resize({ viewportResize: true });
    // Preserve the user's zoom relative to the frame and leave the geographic center, tilt and bearing alone.
    if (before > 0 && Math.abs(after - before) > 0.5) {
      map.jumpTo({ zoom: zoom + Math.log2(after / before) }, { viewportResize: true });
    }
  });
  observer.observe(container);
  return () => observer.disconnect();
}
