export type WeatherMetricKey =
  | "wind"
  | "temperature"
  | "relativeHumidity"
  | "cape"
  | "mslp"
  | "precipitableWater";

export type WeatherMetricCategory = "surface" | "severe";

export type WeatherMetricMeta = {
  key: WeatherMetricKey;
  label: string;
  shortLabel: string;
  description: string;
  category: WeatherMetricCategory;
  unit: string;
  bounds: [number, number];
  precision: number;
  colorStops: { value: number; color: [number, number, number] }[];
};

export type WeatherGridHeader = {
  lo1: number;
  la1: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  refTime: string;
  forecastTime: number;
};

export type WeatherEncoding = {
  kind: "linear";
  offset: number;
  scale: number;
  missingValue: number;
};

export type WeatherFieldBase = {
  key: WeatherMetricKey;
  generatedAt: string;
  validTimeUtc: string;
  source: string;
  header: WeatherGridHeader;
  encoding: WeatherEncoding;
  stats: {
    min: number;
    max: number;
    mean: number;
  };
};

export type WeatherVectorField = WeatherFieldBase & {
  kind: "vector";
  u: number[];
  v: number[];
};

export type WeatherScalarField = WeatherFieldBase & {
  kind: "scalar";
  values: number[];
};

export type WeatherField = WeatherVectorField | WeatherScalarField;

export type WeatherManifestMetric = WeatherMetricMeta & {
  endpoint: string;
  kind: "vector" | "scalar";
  nativeLevelLabel: string;
};

export type WeatherManifest = {
  generatedAt: string;
  source: "GFS";
  runTimeUtc: string;
  forecastHour: number;
  validTimeUtc: string;
  stale: boolean;
  refreshStatus: "live" | "cached" | "error";
  message?: string;
  metrics: WeatherManifestMetric[];
};

export type WeatherStatus = {
  wgrib2Available: boolean;
  decoderAvailable: boolean;
  decoderName: "wgrib2" | "python-eccodes" | null;
  cacheFresh: boolean;
  refreshStatus: WeatherManifest["refreshStatus"];
  generatedAt: string | null;
  validTimeUtc: string | null;
  fieldFilesPresent: Record<WeatherMetricKey, boolean>;
  message?: string;
  lastRefreshError?: string;
};

export const WEATHER_METRICS: WeatherMetricMeta[] = [
  {
    key: "wind",
    label: "风速",
    shortLabel: "风速",
    description: "10 米风速与风向",
    category: "surface",
    unit: "m/s",
    bounds: [0, 45],
    precision: 1,
    colorStops: [
      { value: 0, color: [37, 99, 235] },
      { value: 6, color: [34, 211, 238] },
      { value: 14, color: [45, 212, 191] },
      { value: 24, color: [250, 204, 21] },
      { value: 34, color: [249, 115, 22] },
      { value: 45, color: [244, 63, 94] },
    ],
  },
  {
    key: "temperature",
    label: "温度",
    shortLabel: "温度",
    description: "2 米气温",
    category: "surface",
    unit: "°C",
    bounds: [-45, 45],
    precision: 1,
    colorStops: [
      { value: -45, color: [46, 16, 101] },
      { value: -25, color: [37, 99, 235] },
      { value: -5, color: [34, 211, 238] },
      { value: 10, color: [74, 222, 128] },
      { value: 24, color: [250, 204, 21] },
      { value: 35, color: [249, 115, 22] },
      { value: 45, color: [190, 18, 60] },
    ],
  },
  {
    key: "relativeHumidity",
    label: "相对湿度",
    shortLabel: "湿度",
    description: "2 米相对湿度",
    category: "surface",
    unit: "%",
    bounds: [0, 100],
    precision: 0,
    colorStops: [
      { value: 0, color: [120, 53, 15] },
      { value: 25, color: [202, 138, 4] },
      { value: 50, color: [20, 184, 166] },
      { value: 75, color: [14, 165, 233] },
      { value: 100, color: [99, 102, 241] },
    ],
  },
  {
    key: "cape",
    label: "CAPE（对流有效位能）",
    shortLabel: "CAPE",
    description: "地表对流有效位能",
    category: "severe",
    unit: "J/kg",
    bounds: [0, 4500],
    precision: 0,
    colorStops: [
      { value: 0, color: [15, 23, 42] },
      { value: 500, color: [22, 163, 74] },
      { value: 1200, color: [234, 179, 8] },
      { value: 2200, color: [249, 115, 22] },
      { value: 3300, color: [220, 38, 38] },
      { value: 4500, color: [168, 85, 247] },
    ],
  },
  {
    key: "mslp",
    label: "MSLP（海平面气压）",
    shortLabel: "MSLP",
    description: "平均海平面气压",
    category: "severe",
    unit: "hPa",
    bounds: [940, 1045],
    precision: 0,
    colorStops: [
      { value: 940, color: [127, 29, 29] },
      { value: 970, color: [249, 115, 22] },
      { value: 995, color: [88, 28, 135] },
      { value: 1013, color: [59, 130, 246] },
      { value: 1030, color: [125, 211, 252] },
      { value: 1045, color: [240, 249, 255] },
    ],
  },
  {
    key: "precipitableWater",
    label: "水汽含量",
    shortLabel: "水汽",
    description: "整层可降水量",
    category: "severe",
    unit: "kg/m²",
    bounds: [0, 75],
    precision: 1,
    colorStops: [
      { value: 0, color: [113, 63, 18] },
      { value: 12, color: [71, 85, 105] },
      { value: 25, color: [30, 64, 175] },
      { value: 40, color: [79, 70, 229] },
      { value: 58, color: [34, 211, 238] },
      { value: 75, color: [186, 230, 253] },
    ],
  },
];

export const WEATHER_METRIC_GROUPS = {
  surface: WEATHER_METRICS.filter((metric) => metric.category === "surface"),
  severe: WEATHER_METRICS.filter((metric) => metric.category === "severe"),
} satisfies Record<WeatherMetricCategory, WeatherMetricMeta[]>;

export const defaultWeatherMetric: WeatherMetricKey = "wind";

export function weatherMetricMeta(key: WeatherMetricKey) {
  return WEATHER_METRICS.find((metric) => metric.key === key) ?? WEATHER_METRICS[0];
}

export async function loadWeatherManifest() {
  return fetchJson<WeatherManifest>("/api/weather-earth?request=manifest");
}

export async function loadWeatherStatus() {
  return fetchJson<WeatherStatus>("/api/weather-earth?request=status");
}

export async function loadWeatherField(metric: WeatherMetricKey) {
  return fetchJson<WeatherField>(`/api/weather-earth?metric=${metric}`);
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function formatWeatherValue(metricKey: WeatherMetricKey, value: number | null) {
  const metric = weatherMetricMeta(metricKey);
  if (value === null || !Number.isFinite(value)) {
    return "无数据";
  }
  return `${value.toFixed(metric.precision)} ${metric.unit}`;
}

export function decodeWeatherValue(value: number, encoding: WeatherEncoding) {
  if (value === encoding.missingValue) {
    return null;
  }
  return encoding.offset + value * encoding.scale;
}

export function weatherValueAtIndex(field: WeatherField, index: number) {
  if (field.kind === "vector") {
    const u = decodeWeatherValue(field.u[index], field.encoding);
    const v = decodeWeatherValue(field.v[index], field.encoding);
    if (u === null || v === null) {
      return null;
    }
    return Math.hypot(u, v);
  }

  return decodeWeatherValue(field.values[index], field.encoding);
}

export function readWeatherFieldAt(field: WeatherField, lng: number, lat: number) {
  const { header } = field;
  const y = (header.la1 - lat) / header.dy;
  if (y < 0 || y > header.ny - 1) {
    return null;
  }

  const x = floorMod(lng - header.lo1, 360) / header.dx;
  const i0 = Math.floor(x) % header.nx;
  const i1 = (i0 + 1) % header.nx;
  const j0 = Math.floor(y);
  const j1 = Math.min(j0 + 1, header.ny - 1);
  const tx = x - Math.floor(x);
  const ty = y - j0;

  if (field.kind === "vector") {
    const u = interpolateEncoded(field.u, field.encoding, header.nx, i0, i1, j0, j1, tx, ty);
    const v = interpolateEncoded(field.v, field.encoding, header.nx, i0, i1, j0, j1, tx, ty);
    if (u === null || v === null) {
      return null;
    }
    return {
      value: Math.hypot(u, v),
      u,
      v,
    };
  }

  const value = interpolateEncoded(field.values, field.encoding, header.nx, i0, i1, j0, j1, tx, ty);
  return value === null ? null : { value };
}

function interpolateEncoded(
  values: number[],
  encoding: WeatherEncoding,
  nx: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  tx: number,
  ty: number,
) {
  const g00 = decodeWeatherValue(values[j0 * nx + i0], encoding);
  const g10 = decodeWeatherValue(values[j0 * nx + i1], encoding);
  const g01 = decodeWeatherValue(values[j1 * nx + i0], encoding);
  const g11 = decodeWeatherValue(values[j1 * nx + i1], encoding);
  if (g00 === null || g10 === null || g01 === null || g11 === null) {
    return null;
  }

  const top = g00 * (1 - tx) + g10 * tx;
  const bottom = g01 * (1 - tx) + g11 * tx;
  return top * (1 - ty) + bottom * ty;
}

export function weatherColor(metricKey: WeatherMetricKey, value: number, alpha = 0.72) {
  const metric = weatherMetricMeta(metricKey);
  const stops = metric.colorStops;
  const lowerBound = stops[0];
  const upperBound = stops[stops.length - 1];
  if (value <= lowerBound.value) {
    return rgba(lowerBound.color, alpha);
  }
  if (value >= upperBound.value) {
    return rgba(upperBound.color, alpha);
  }

  const upperIndex = stops.findIndex((stop) => value <= stop.value);
  const upper = stops[upperIndex];
  const lower = stops[upperIndex - 1];
  const span = Math.max(upper.value - lower.value, 0.0001);
  const amount = (value - lower.value) / span;
  return rgba([
    mixChannel(lower.color[0], upper.color[0], amount),
    mixChannel(lower.color[1], upper.color[1], amount),
    mixChannel(lower.color[2], upper.color[2], amount),
  ], alpha);
}

export function weatherGradientStyle(metricKey: WeatherMetricKey) {
  const metric = weatherMetricMeta(metricKey);
  const [min, max] = metric.bounds;
  const stops = metric.colorStops.map((stop) => {
    const pct = ((stop.value - min) / Math.max(max - min, 0.0001)) * 100;
    return `rgb(${stop.color.join(", ")}) ${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function weatherMetricEndpoint(metricKey: WeatherMetricKey) {
  return `/api/weather-earth?metric=${metricKey}`;
}

function floorMod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function mixChannel(start: number, end: number, amount: number) {
  return Math.round(start + (end - start) * amount);
}

function rgba(rgb: [number, number, number], alpha: number) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
