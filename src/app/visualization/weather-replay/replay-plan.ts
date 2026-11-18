import type { ReplayBounds } from "@/lib/weather-replay/model";

/** Equirectangular map view with cos(latitude) aspect, wheel zoom around the cursor and drag panning. */
export function createPlanCamera(target: HTMLElement, invalidate: () => void, padding: { left: number; right: number; top: number; bottom: number }) {
  let zoom = 1;
  let pan: [number, number] = [0, 0];
  let bounds: ReplayBounds = { west: 0, east: 1, south: 0, north: 1 };
  let width = 1, height = 1;
  let scale = 1, originX = 0, originY = 0, aspect = 1;
  let center: [number, number] = [0, 0];
  const pointers = new Map<number, [number, number]>();
  let pinch = 0;

  function layout(next: ReplayBounds, w: number, h: number) {
    bounds = next;
    width = w;
    height = h;
    aspect = Math.cos((bounds.north + bounds.south) * Math.PI / 360);
    const spanX = (bounds.east - bounds.west) * aspect, spanY = bounds.north - bounds.south;
    const compact = w < 640;
    const pad = compact ? { left: 12, right: 12, top: 56, bottom: 24 } : padding;
    const fit = Math.min((w - pad.left - pad.right) / spanX, (h - pad.top - pad.bottom) / spanY);
    scale = fit * zoom;
    center = [pad.left + (w - pad.left - pad.right) / 2, pad.top + (h - pad.top - pad.bottom) / 2];
    originX = pad.left + (w - pad.left - pad.right) / 2 + pan[0] - spanX * scale / 2;
    originY = pad.top + (h - pad.top - pad.bottom) / 2 + pan[1] - spanY * scale / 2;
  }
  const point = (lon: number, lat: number): [number, number] =>
    [originX + (lon - bounds.west) * aspect * scale, originY + (bounds.north - lat) * scale];
  const unpoint = (x: number, y: number): [number, number] =>
    [bounds.west + (x - originX) / (aspect * scale), bounds.north - (y - originY) / scale];

  function zoomAt(factor: number, x = width / 2, y = height / 2) {
    const next = Math.max(.7, Math.min(6, zoom * factor));
    const applied = next / zoom;
    // Keep the geographic point under the cursor fixed.
    const [cx, cy] = center;
    pan = [(pan[0] - (x - cx)) * applied + (x - cx), (pan[1] - (y - cy)) * applied + (y - cy)];
    zoom = next;
    invalidate();
  }
  function onDown(event: PointerEvent) {
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    target.setPointerCapture(event.pointerId);
    pinch = 0;
  }
  function onMove(event: PointerEvent) {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size > 1) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomAt(distance / pinch);
      pinch = distance;
      return;
    }
    pan = [pan[0] + event.clientX - before[0], pan[1] + event.clientY - before[1]];
    invalidate();
  }
  function onUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    pinch = 0;
  }
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const box = target.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * .0012), event.clientX - box.left, event.clientY - box.top);
  }
  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
  target.addEventListener("wheel", onWheel, { passive: false });

  return {
    layout, point, unpoint,
    get scale() { return scale; },
    get key() { return [zoom, pan[0], pan[1], width, height].join("|"); },
    zoom: (factor: number) => zoomAt(factor),
    reset() { zoom = 1; pan = [0, 0]; invalidate(); },
    dispose() {
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      target.removeEventListener("wheel", onWheel);
    },
  };
}

export type PlanCamera = ReturnType<typeof createPlanCamera>;

/** Draw an equirectangular image covering `imageBounds` through the camera transform. */
export function drawGeoImage(context: CanvasRenderingContext2D, camera: PlanCamera, image: CanvasImageSource & { width: number; height: number }, imageBounds: ReplayBounds) {
  const [x0, y0] = camera.point(imageBounds.west, imageBounds.north);
  const [x1, y1] = camera.point(imageBounds.east, imageBounds.south);
  context.drawImage(image, x0, y0, x1 - x0, y1 - y0);
}

/** Clip later drawing to the map image rectangle. Call inside save()/restore(). */
export function clipToBounds(context: CanvasRenderingContext2D, camera: PlanCamera, bounds: ReplayBounds) {
  const [x0, y0] = camera.point(bounds.west, bounds.north);
  const [x1, y1] = camera.point(bounds.east, bounds.south);
  context.beginPath();
  context.rect(x0, y0, x1 - x0, y1 - y0);
  context.clip();
}

export function niceTicks(start: number, end: number, target: number) {
  const spacing = (end - start) / target;
  const magnitude = 10 ** Math.floor(Math.log10(spacing));
  const step = (spacing / magnitude <= 2 ? 2 : spacing / magnitude <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let i = Math.ceil(start / step); i * step <= end + 1e-9; i++) ticks.push(Number((i * step).toFixed(6)));
  return ticks;
}

export function degreeLabel(value: number, longitude: boolean) {
  const hemisphere = longitude ? (value < 0 ? "W" : value > 0 ? "E" : "") : (value < 0 ? "S" : value > 0 ? "N" : "");
  return Math.abs(value) + "°" + hemisphere;
}

/** Text with a halo for map labels. */
export function haloText(context: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, halo: string, width = 3) {
  context.lineJoin = "round";
  context.strokeStyle = halo;
  context.lineWidth = width;
  context.strokeText(text, x, y);
  context.fillStyle = fill;
  context.fillText(text, x, y);
}

/** Frame the data domain with outside tick labels; no interior graticule. */
export function paintFrame(context: CanvasRenderingContext2D, camera: PlanCamera, bounds: ReplayBounds, color: string, text: string, compact: boolean) {
  const [x0, y0] = camera.point(bounds.west, bounds.north);
  const [x1, y1] = camera.point(bounds.east, bounds.south);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.strokeRect(Math.round(x0) + .5, Math.round(y0) + .5, Math.round(x1 - x0), Math.round(y1 - y0));
  context.font = (compact ? 9 : 10) + "px system-ui, sans-serif";
  context.fillStyle = text;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const lon of niceTicks(bounds.west, bounds.east, compact ? 3 : 5)) {
    const [x] = camera.point(lon, bounds.south);
    context.beginPath();
    context.moveTo(x, y1);
    context.lineTo(x, y1 + 4);
    context.stroke();
    context.fillText(degreeLabel(lon, true), x, y1 + 6);
  }
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const lat of niceTicks(bounds.south, bounds.north, compact ? 3 : 5)) {
    const [, y] = camera.point(bounds.west, lat);
    context.beginPath();
    context.moveTo(x0, y);
    context.lineTo(x0 - 4, y);
    context.stroke();
    context.fillText(degreeLabel(lat, false), x0 - 6, y);
  }
}
