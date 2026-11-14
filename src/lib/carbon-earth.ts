import type { Feature, FeatureCollection, Point } from "geojson";

export type CarbonGrid = {
  width: number;
  height: number;
  longitudeMin: number;
  latitudeMax: number;
  dx: number;
  dy: number;
};

export type CarbonFrameStats = {
  min: number;
  max: number;
  mean: number;
  sumKgCPerHour: number;
  nonzeroCount: number;
  nonzeroPercent: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
};

export type CarbonManifestFrame = {
  date: string;
  sector: string;
  unit: "kgC/h";
  grid: CarbonGrid;
  stats: CarbonFrameStats;
  sizeBytes: number;
  endpoint: string;
};

export type CarbonManifest = {
  generatedAt: string;
  dates: string[];
  sectors: string[];
  latestDate: string | null;
  frames: CarbonManifestFrame[];
  sources: {
    sector: string;
    month: string;
    fileName: string;
    url: string;
    apiUpdatedAt: string | null;
    attributes: Record<string, string>;
  }[];
};

export type CarbonFrame = CarbonManifestFrame & {
  values: Float32Array;
};

type CarbonHeatProperties = {
  value: number;
  weight: number;
};

export const carbonSectorLabels: Record<string, string> = {
  total: "总排放",
  Power: "电力",
  Industry: "工业",
  Residential: "居民消费",
  GroundTransportation: "地面交通",
  DomesticAviation: "国内航空",
  InternationalAviation: "国际航空",
  InternationalShipping: "国际航运",
};

let manifestPromise: Promise<CarbonManifest> | null = null;

export async function loadCarbonManifest() {
  manifestPromise ??= fetch("/api/carbon-earth?request=manifest", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        throw new Error("无法读取碳排放数据目录。");
      }
      return response.json() as Promise<CarbonManifest>;
    })
    .catch((error: unknown) => {
      manifestPromise = null;
      throw error;
    });
  return manifestPromise;
}

export async function loadCarbonFrame(meta: CarbonManifestFrame, signal?: AbortSignal) {
  const canDecompress = typeof DecompressionStream !== "undefined";
  const response = await fetch(canDecompress ? meta.endpoint : `${meta.endpoint}&raw=1`, { signal });
  if (!response.ok) {
    throw new Error("无法读取当前碳排放帧。");
  }
  const encoded = await response.arrayBuffer();
  const decoded = canDecompress ? await decompressGzip(encoded) : encoded;
  const expectedBytes = meta.grid.width * meta.grid.height * Float32Array.BYTES_PER_ELEMENT;
  if (decoded.byteLength !== expectedBytes) {
    throw new Error(`碳排放帧尺寸不匹配：${decoded.byteLength}/${expectedBytes}`);
  }
  return {
    ...meta,
    values: new Float32Array(decoded),
  } satisfies CarbonFrame;
}

async function decompressGzip(encoded: ArrayBuffer) {
  const stream = new Blob([encoded])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function carbonGridPoint(frame: CarbonFrame, longitude: number, latitude: number) {
  const { grid } = frame;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  const normalizedLongitude = ((longitude - grid.longitudeMin) % 360 + 360) % 360;
  const x = Math.round(normalizedLongitude / grid.dx) % grid.width;
  const y = Math.round((grid.latitudeMax - latitude) / grid.dy);
  if (y < 0 || y >= grid.height) return null;
  const raw = frame.values[y * grid.width + x];
  const lng = grid.longitudeMin + x * grid.dx;
  return {
    value: Number.isFinite(raw) && raw >= 0 ? raw : null,
    longitude: ((lng + 180) % 360 + 360) % 360 - 180,
    latitude: grid.latitudeMax - y * grid.dy,
  };
}

export function sampleCarbonFrame(frame: CarbonFrame, longitude: number, latitude: number) {
  return carbonGridPoint(frame, longitude, latitude)?.value ?? 0;
}

export function carbonFrameColorMax(frame: CarbonManifestFrame) {
  return Math.max(frame.stats.p99 || 0, frame.stats.p95 || 0, 1);
}

export function buildCarbonHeatCollection(frame: CarbonFrame, scaleMax = carbonFrameColorMax(frame)): FeatureCollection<Point, CarbonHeatProperties> {
  const features: Feature<Point, CarbonHeatProperties>[] = [];
  const { grid, values } = frame;
  const logarithmicScale = Math.log1p(scaleMax);

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }

    const column = index % grid.width;
    const row = Math.floor(index / grid.width);
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          grid.longitudeMin + column * grid.dx,
          grid.latitudeMax - row * grid.dy,
        ],
      },
      properties: {
        value,
        weight: Math.min(1, Math.log1p(value) / logarithmicScale),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export function carbonColor(value: number, scaleMax: number, alpha = 0.84) {
  if (!Number.isFinite(value) || value <= 0 || scaleMax <= 0) {
    return [0, 0, 0, 0] as const;
  }
  const amount = Math.min(1, Math.log1p(value) / Math.log1p(scaleMax));
  const stops: [number, [number, number, number]][] = [
    [0, [9, 92, 82]],
    [0.28, [16, 185, 129]],
    [0.52, [163, 230, 53]],
    [0.72, [250, 204, 21]],
    [0.88, [249, 115, 22]],
    [1, [248, 250, 252]],
  ];
  const upperIndex = Math.max(1, stops.findIndex(([position]) => amount <= position));
  const [lowerPosition, lowerColor] = stops[upperIndex - 1];
  const [upperPosition, upperColor] = stops[upperIndex];
  const mix = (amount - lowerPosition) / Math.max(0.0001, upperPosition - lowerPosition);
  return [
    Math.round(lowerColor[0] + (upperColor[0] - lowerColor[0]) * mix),
    Math.round(lowerColor[1] + (upperColor[1] - lowerColor[1]) * mix),
    Math.round(lowerColor[2] + (upperColor[2] - lowerColor[2]) * mix),
    Math.round(alpha * 255),
  ] as const;
}

export function formatCarbonValue(value: number) {
  if (!Number.isFinite(value) || value < 0) return "缺测";
  if (value === 0) return "0 kgC/h";
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} ktC/h`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} tC/h`;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} kgC/h`;
}

export function formatCarbonTotal(sumKgCPerHour: number) {
  const millionTonnesCo2PerDay = sumKgCPerHour * 24 * (44 / 12) / 1_000_000_000;
  return `${millionTonnesCo2PerDay.toFixed(2)} MtCO₂/日`;
}
