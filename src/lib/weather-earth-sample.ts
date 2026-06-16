import {
  WEATHER_METRICS,
  type WeatherField,
  type WeatherEncoding,
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

const sampleEncodings: Record<WeatherMetricKey, WeatherEncoding> = {
  wind: { kind: "linear", offset: -80, scale: 0.1, missingValue: 65535 },
  temperature: { kind: "linear", offset: -80, scale: 0.1, missingValue: 65535 },
  relativeHumidity: { kind: "linear", offset: 0, scale: 0.1, missingValue: 65535 },
  cape: { kind: "linear", offset: 0, scale: 0.1, missingValue: 65535 },
  mslp: { kind: "linear", offset: 900, scale: 0.1, missingValue: 65535 },
  precipitableWater: { kind: "linear", offset: 0, scale: 0.1, missingValue: 65535 },
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
  const encoding = sampleEncodings[metricKey];
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
        const wind = syntheticWindVector(lng, lat);
        u.push(encode(wind.u, encoding));
        v.push(encode(wind.v, encoding));
        statsValues.push(Math.hypot(wind.u, wind.v));
      } else {
        values.push(encode(sample, encoding));
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
    encoding,
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
      return clamp(Math.hypot(syntheticWindVector(lng, lat).u, syntheticWindVector(lng, lat).v), 0, 42);
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

function syntheticWindVector(lng: number, lat: number) {
  const normalizedLng = normalizeLongitude(lng);
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (normalizedLng * Math.PI) / 180;
  const polar = Math.abs(lat) / 90;
  const jetNorth = gaussian(normalizedLng, lat, 146, 42, 78, 12);
  const jetSouth = gaussian(normalizedLng, lat, -42, -45, 92, 14);
  const subtropicalJet = Math.exp(-((Math.abs(lat) - 31) ** 2) / (2 * 10 * 10));
  const trades = -3.6 * Math.cos(latRad) * Math.max(0, 1 - polar * 1.35);
  let u = 3.2 + trades + 12.5 * subtropicalJet + 8.5 * jetNorth + 7.8 * jetSouth;
  let v = 2.1 * Math.sin(lonRad * 1.35) * Math.cos(latRad) + 1.4 * Math.sin((normalizedLng + lat * 1.8) * Math.PI / 70);

  const vortices = [
    { lng: 126, lat: 24, scale: 19, strength: 17 },
    { lng: -88, lat: 31, scale: 24, strength: -14 },
    { lng: 32, lat: -38, scale: 28, strength: 12 },
    { lng: -164, lat: 48, scale: 32, strength: -10 },
  ];

  vortices.forEach((vortex) => {
    const contribution = vortexWind(normalizedLng, lat, vortex.lng, vortex.lat, vortex.scale, vortex.strength);
    u += contribution.u;
    v += contribution.v;
  });

  return { u, v };
}

function vortexWind(lng: number, lat: number, centerLng: number, centerLat: number, scale: number, strength: number) {
  const dx = shortestLongitudeDelta(lng, centerLng) / Math.max(Math.cos((centerLat * Math.PI) / 180), 0.28);
  const dy = lat - centerLat;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) {
    return { u: 0, v: 0 };
  }

  const falloff = Math.exp(-(distance * distance) / (2 * scale * scale));
  const spiral = 0.24 * strength * falloff;
  const tangent = strength * falloff;
  return {
    u: (-dy / distance) * tangent + (dx / distance) * spiral,
    v: (dx / distance) * tangent + (dy / distance) * spiral,
  };
}

function gaussian(lng: number, lat: number, centerLng: number, centerLat: number, lngScale: number, latScale: number) {
  const dlng = Math.abs(shortestLongitudeDelta(normalizeLongitude(lng), centerLng));
  const dlat = lat - centerLat;
  return Math.exp(-((dlng * dlng) / (2 * lngScale * lngScale) + (dlat * dlat) / (2 * latScale * latScale)));
}

function encode(value: number, encoding: WeatherEncoding) {
  return Math.max(0, Math.min(65534, Math.round((value - encoding.offset) / encoding.scale)));
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

function normalizeLongitude(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function shortestLongitudeDelta(lng: number, centerLng: number) {
  const delta = normalizeLongitude(lng) - normalizeLongitude(centerLng);
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}
