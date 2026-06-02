import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourcePath = path.join(repoRoot, "public/data/osm-power/china-power-lines.geojson");
const trunkOutputPath = path.join(repoRoot, "public/data/osm-power/china-transmission-preview.geojson");
const detailOutputPath = path.join(repoRoot, "public/data/osm-power/china-transmission-detail-preview.geojson");

const classMeta = [
  { key: "1000", minKv: 735, color: "#f8fafc" },
  { key: "750", minKv: 500, color: "#22d3ee" },
  { key: "500", minKv: 345, color: "#0ea5e9" },
  { key: "220", minKv: 230, color: "#3b82f6" },
  { key: "110", minKv: 100, color: "#6366f1" },
  { key: "35", minKv: 31, color: "#a855f7" },
  { key: "low", minKv: 0, color: "#9333ea" },
];

const trunkClasses = new Set(["1000", "750"]);
const detailClasses = new Set(["500", "220", "110", "35", "low"]);
const detailLowSamplePercent = 28;
const maxLinesPerFeature = 900;

function readNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  return 0;
}

function voltageKv(properties) {
  const localKv = readNumber(properties.voltageKv);

  if (localKv > 0) {
    return localKv;
  }

  const rawVoltage = readNumber(properties.voltage);
  return rawVoltage > 2000 ? rawVoltage / 1000 : rawVoltage;
}

function voltageClassForKv(kv) {
  return classMeta.find((item) => kv >= item.minKv)?.key ?? "low";
}

function colorForClass(voltageClass) {
  return classMeta.find((item) => item.key === voltageClass)?.color ?? "#22d3ee";
}

function representativeKv(voltageClass) {
  return classMeta.find((item) => item.key === voltageClass)?.minKv ?? 0;
}

function classLabel(voltageClass) {
  const labels = {
    "1000": "China 735kV+ transmission",
    "750": "China 500-734kV transmission",
    "500": "China 345-499kV transmission",
    "220": "China 230-344kV transmission",
    "110": "China 100-229kV transmission",
    "35": "China 31-99kV transmission",
    low: "China <31kV transmission",
  };
  return labels[voltageClass] ?? "China transmission";
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function quantizeCoordinate([lon, lat], digits) {
  const scale = 10 ** digits;
  return [
    Math.round(lon * scale) / scale,
    Math.round(lat * scale) / scale,
  ];
}

function squaredDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];

  if (dx === 0 && dy === 0) {
    const pointDx = point[0] - start[0];
    const pointDy = point[1] - start[1];
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  const projectedX = start[0] + t * dx;
  const projectedY = start[1] + t * dy;
  const pointDx = point[0] - projectedX;
  const pointDy = point[1] - projectedY;
  return pointDx * pointDx + pointDy * pointDy;
}

function simplifyLine(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) {
    return points;
  }

  const keep = new Uint8Array(points.length);
  const stack = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;
  keep[0] = 1;
  keep[points.length - 1] = 1;

  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let maxDistance = 0;
    let maxIndex = 0;

    for (let index = start + 1; index < end; index += 1) {
      const distance = squaredDistance(points[index], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }

    if (maxDistance > toleranceSquared) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function normalizeLine(rawCoordinates, voltageClass) {
  if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
    return null;
  }

  const digits = voltageClass === "low" || voltageClass === "35" ? 3 : 4;
  const toleranceByClass = {
    "1000": 0.0025,
    "750": 0.0035,
    "500": 0.005,
    "220": 0.007,
    "110": 0.01,
    "35": 0.012,
    low: 0.014,
  };
  const simplified = simplifyLine(rawCoordinates, toleranceByClass[voltageClass] ?? 0.01);
  const coordinates = [];

  for (const coordinate of simplified) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      continue;
    }

    const point = quantizeCoordinate(coordinate, digits);
    const previous = coordinates[coordinates.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      coordinates.push(point);
    }
  }

  return coordinates.length >= 2 ? coordinates : null;
}

function featureLength(rawCoordinates) {
  let length = 0;

  for (let index = 1; index < rawCoordinates.length; index += 1) {
    const [lon, lat] = rawCoordinates[index];
    const [previousLon, previousLat] = rawCoordinates[index - 1];
    const dx = lon - previousLon;
    const dy = lat - previousLat;
    length += Math.sqrt(dx * dx + dy * dy);
  }

  return length;
}

function shouldKeepDetailFeature(feature, voltageClass, rawCoordinates) {
  if (voltageClass !== "low") {
    return true;
  }

  const id = String(feature.properties?.id ?? "");
  if (featureLength(rawCoordinates) >= 0.18) {
    return true;
  }

  return hashString(id) % 100 < detailLowSamplePercent;
}

function normalizeFeatureCoordinates(feature, voltageClass) {
  const rawCoordinates = feature.geometry?.coordinates;
  return normalizeLine(rawCoordinates, voltageClass);
}

function emptySummary() {
  return classMeta.reduce((summary, item) => {
    summary[item.key] = { features: 0, coordinates: 0 };
    return summary;
  }, {});
}

function addSummary(summary, voltageClass, coordinates) {
  summary[voltageClass].features += 1;
  summary[voltageClass].coordinates += coordinates.length;
}

function emptyGroups() {
  return classMeta.reduce((groups, item) => {
    groups[item.key] = [];
    return groups;
  }, {});
}

function addGroupedLine(groups, summary, voltageClass, coordinates) {
  groups[voltageClass].push(coordinates);
  addSummary(summary, voltageClass, coordinates);
}

function groupedFeatures(groups) {
  return classMeta.flatMap((item) => {
    const lines = groups[item.key];
    const features = [];

    for (let offset = 0; offset < lines.length; offset += maxLinesPerFeature) {
      const chunk = lines.slice(offset, offset + maxLinesPerFeature);
      const chunkNumber = Math.floor(offset / maxLinesPerFeature) + 1;
      features.push({
        type: "Feature",
        geometry: {
          type: "MultiLineString",
          coordinates: chunk,
        },
        properties: {
          id: `china-transmission-${item.key}-${chunkNumber}`,
          name: `${classLabel(item.key)} ${chunkNumber}`,
          kind: "grid-line",
          voltageKv: representativeKv(item.key),
          voltageClass: item.key,
          color: colorForClass(item.key),
          sourceLayer: "osmLines",
          status: "Operating",
        },
      });
    }

    return features;
  });
}

function writeFeatureCollection(outputPath, features) {
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    "utf8",
  );
}

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const trunkGroups = emptyGroups();
const detailGroups = emptyGroups();
const sourceSummary = emptySummary();
const trunkSummary = emptySummary();
const detailSummary = emptySummary();

for (const feature of source.features ?? []) {
  const rawCoordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== "LineString" || !Array.isArray(rawCoordinates)) {
    continue;
  }

  const kv = voltageKv(feature.properties ?? {});
  const voltageClass = voltageClassForKv(kv);
  sourceSummary[voltageClass].features += 1;
  sourceSummary[voltageClass].coordinates += rawCoordinates.length;

  if (trunkClasses.has(voltageClass)) {
    const coordinates = normalizeFeatureCoordinates(feature, voltageClass);
    if (coordinates) {
      addGroupedLine(trunkGroups, trunkSummary, voltageClass, coordinates);
    }
    continue;
  }

  if (detailClasses.has(voltageClass) && shouldKeepDetailFeature(feature, voltageClass, rawCoordinates)) {
    const coordinates = normalizeFeatureCoordinates(feature, voltageClass);
    if (coordinates) {
      addGroupedLine(detailGroups, detailSummary, voltageClass, coordinates);
    }
  }
}

writeFeatureCollection(trunkOutputPath, groupedFeatures(trunkGroups));
writeFeatureCollection(detailOutputPath, groupedFeatures(detailGroups));

console.log(JSON.stringify({
  source: sourceSummary,
  trunk: trunkSummary,
  detail: detailSummary,
  outputs: {
    trunk: path.relative(repoRoot, trunkOutputPath),
    detail: path.relative(repoRoot, detailOutputPath),
  },
}, null, 2));
