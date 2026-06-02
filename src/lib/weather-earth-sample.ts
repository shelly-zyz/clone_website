import {
  WEATHER_METRICS,
  type WeatherField,
  type WeatherGridHeader,
  type WeatherManifest,
  type WeatherMetricKey,
  weatherMetricEndpoint,
} from "@/lib/weather-earth";

const sampleGeneratedAt = "2026-05-28T00:00:00.000Z";
const sampleRunTimeUtc = "2026-05-28T00:00:00.000Z";
const sampleForecastHour = 3;
const sampleValidTimeUtc = "2026-05-28T03:00:00.000Z";

const sampleHeader: WeatherGridHeader = {
  lo1: 0,
  la1: 90,
  dx: 2,
  dy: 2,
  nx: 180,
  ny: 91,
  refTime: sampleRunTimeUtc,
  forecastTime: sampleForecastHour,
};

const sampleEncoding = {
  kind: "linear" as const,
  offset: 0,
  scale: 0.1,
  missingValue: 65535,
};

const nativeLevelLabels: Record<WeatherMetricKey, string> = {
  wind: "10 m above ground",
  temperature: "2 m above ground",
  relativeHumidity: "2 m above ground",
  cape: "surface",
  mslp: "mean sea level",
  precipitableWater: "entire atmosphere",
};

export function sampleWeatherManifest(message = "使用内置演示气象场；自动实时缓存尚不可用。"): WeatherManifest {
  return {
    generatedAt: sampleGeneratedAt,
    source: "GFS",
    runTimeUtc: sampleRunTimeUtc,
    forecastHour: sampleForecastHour,
    validTimeUtc: sampleValidTimeUtc,
    stale: true,
    refreshStatus: "sample-fallback",
    message,
    metrics: WEATHER_METRICS.map((metric) => ({
      ...metric,
      kind: metric.key === "wind" ? "vector" : "scalar",
      endpoint: weatherMetricEndpoint(metric.key),
      nativeLevelLabel: nativeLevelLabels[metric.key],
    })),
  };
}

export function sampleWeatherField(metricKey: WeatherMetricKey): WeatherField {
  const values: number[] = [];
  const u: number[] = [];
  const v: number[] = [];
  const statsValues: number[] = [];

  for (let j = 0; j < sampleHeader.ny; j += 1) {
    const lat = sampleHeader.la1 - j * sampleHeader.dy;
    for (let i = 0; i < sampleHeader.nx; i += 1) {
      const lng = sampleHeader.lo1 + i * sampleHeader.dx;
      const sample = syntheticWeatherValue(metricKey, lng, lat);
      if (metricKey === "wind") {
        const radians = ((lng + lat * 0.72) * Math.PI) / 180;
        const wave = Math.sin((lat * Math.PI) / 180);
        const eastward = sample * (0.58 + 0.42 * Math.cos(radians));
        const northward = sample * 0.34 * wave;
        u.push(encode(eastward));
        v.push(encode(northward));
        statsValues.push(Math.hypot(eastward, northward));
      } else {
        values.push(encode(sample));
        statsValues.push(sample);
      }
    }
  }

  const base = {
    key: metricKey,
    generatedAt: sampleGeneratedAt,
    validTimeUtc: sampleValidTimeUtc,
    source: "GFS sample fallback",
    header: sampleHeader,
    encoding: sampleEncoding,
    stats: summarize(statsValues),
  };

  if (metricKey === "wind") {
    return {
      ...base,
      kind: "vector",
      u,
      v,
    };
  }

  return {
    ...base,
    kind: "scalar",
    values,
  };
}

function syntheticWeatherValue(metricKey: WeatherMetricKey, lng: number, lat: number) {
  const lonWave = Math.sin((lng * Math.PI) / 90);
  const latWave = Math.cos((lat * Math.PI) / 90);
  const storm = gaussian(lng, lat, 126, 24, 22, 13) + gaussian(lng, lat, -88, 29, 25, 16);
  const polar = Math.abs(lat) / 90;

  switch (metricKey) {
    case "wind":
      return clamp(5 + 10 * polar + 7 * storm + 2.4 * Math.max(lonWave, 0), 0, 42);
    case "temperature":
      return clamp(31 - 55 * polar + 5 * lonWave + 3 * latWave, -42, 42);
    case "relativeHumidity":
      return clamp(48 + 25 * latWave + 22 * storm - 11 * polar, 4, 100);
    case "cape":
      return clamp(120 + 3100 * storm + 650 * Math.max(latWave, 0) + 280 * Math.max(lonWave, 0), 0, 4400);
    case "mslp":
      return clamp(1014 - 32 * storm + 12 * polar + 6 * lonWave, 940, 1045);
    case "precipitableWater":
      return clamp(12 + 35 * Math.max(latWave, 0) + 24 * storm - 9 * polar, 0, 74);
  }
}

function gaussian(lng: number, lat: number, centerLng: number, centerLat: number, lngScale: number, latScale: number) {
  const dlng = Math.min(Math.abs(lng - centerLng), 360 - Math.abs(lng - centerLng));
  const dlat = lat - centerLat;
  return Math.exp(-((dlng * dlng) / (2 * lngScale * lngScale) + (dlat * dlat) / (2 * latScale * latScale)));
}

function encode(value: number) {
  return Math.max(0, Math.min(65534, Math.round((value - sampleEncoding.offset) / sampleEncoding.scale)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function summarize(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return {
    min: Number(min.toFixed(3)),
    max: Number(max.toFixed(3)),
    mean: Number(mean.toFixed(3)),
  };
}
