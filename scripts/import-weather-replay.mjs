import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { geoEquirectangular, geoStream } from "d3-geo";
import pg from "pg";
import { feature } from "topojson-client";

const id = "us-southeast-2026-09-26";
const region = "美国东南沿海";
const bounds = { south: 23, north: 35, west: -80, east: -64 };
const start = Date.UTC(2026, 8, 26, 9);
const end = Date.UTC(2026, 8, 26, 15);
const width = 3600;
const height = 1801;
const sampleStep = 2; // Display every second 0.1° source grid point.
const cols = (bounds.east - bounds.west) * 10 / sampleStep + 1;
const rows = (bounds.north - bounds.south) * 10 / sampleStep + 1;
const hour = 3_600_000;
const contentType = "application/json";
const epoch = (time) => new Date(time).toISOString();
const stamp = (time) => epoch(time).replace(/[-:]/g, "").slice(0, 15);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function frameUrl(source, time) {
  const prefix = `zarr/2026_to_present/${stamp(time)}`;
  return source === "satellite"
    ? `https://storage.googleapis.com/satweave_1/${prefix}/mosaic.zarr/mosaic_11200_nm/c/0/0/0`
    : `https://storage.googleapis.com/pardig_1/NRT/${prefix}/predictions.zarr/precipitation/c/0/0`;
}

async function fetchFrame({ source, time }) {
  const url = frameUrl(source, time);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = zstdDecompressSync(Buffer.from(await response.arrayBuffer()), {
        maxOutputLength: width * height * 4,
      });
      if (bytes.length !== width * height * 4) throw new Error("Unexpected Zarr frame size");
      const values = [];
      const satellite = source === "satellite";
      let valid = 0;
      for (let row = 0; row < rows; row++) {
        const latIndex = bounds.south * 10 + row * sampleStep;
        const sourceRow = 900 + (satellite ? -latIndex : latIndex);
        for (let col = 0; col < cols; col++) {
          const sourceCol = (bounds.west * 10 + col * sampleStep + width) % width;
          const raw = bytes.readFloatLE(4 * (sourceRow * width + sourceCol));
          const value = satellite ? raw : raw * 1000;
          const inRange = satellite ? value >= 150 && value <= 350 : value >= 0 && value <= 75.001;
          values.push(inRange ? Math.round(Math.min(value, satellite ? 350 : 75) * 10) / 10 : null);
          if (inRange) valid++;
        }
      }
      if (!valid) throw new Error("No valid values in the selected region");
      return { source, time: epoch(time), url, values };
    } catch (error) {
      if (attempt === 3) throw new Error(`Could not read ${url}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function coastline() {
  const topology = JSON.parse(await readFile(new URL("../public/earth/data/earth-topo.json", import.meta.url), "utf8"));
  const { south, north, west, east } = bounds;
  const projection = geoEquirectangular().rotate([-(west + east) / 2, 0])
    .center([0, (south + north) / 2]).scale(180 / Math.PI)
    .translate([(east - west) / 2, (north - south) / 2])
    .clipExtent([[0, 0], [east - west, north - south]]);
  const lines = [];
  let path = [];
  geoStream(feature(topology, topology.objects.coastline_50m), projection.stream({
    lineStart() { path = []; },
    point(x, y) { path.push([+(x / (east - west)).toFixed(5), +(1 - y / (north - south)).toFixed(5)]); },
    lineEnd() { if (path.length > 1) lines.push(path); },
  }));
  if (!lines.length) throw new Error("No coastline in the replay region");
  return lines;
}

async function publish() {
  const connection = new URL(required("DATA_AGENT_INGEST_DATABASE_URL"));
  const gateway = process.env.DATA_AGENT_INGEST_DB_HOST;
  if (gateway) connection.hostname = gateway;

  const s3 = new S3Client({
    endpoint: required("WEATHER_REPLAY_S3_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("WEATHER_REPLAY_S3_ACCESS_KEY"),
      secretAccessKey: required("WEATHER_REPLAY_S3_SECRET_KEY"),
    },
  });
  const db = new pg.Client({ connectionString: connection.href, connectionTimeoutMillis: 5000 });
  let connected = false;
  try {
    await db.connect();
    connected = true;
    const jobs = [];
    for (let time = start; time <= end; time += hour / 4) {
      if (time % hour === 0) jobs.push({ source: "satellite", time });
      jobs.push({ source: "rain", time });
    }
    const frames = [];
    for (let index = 0; index < jobs.length; index += 4) {
      frames.push(...await Promise.all(jobs.slice(index, index + 4).map(fetchFrame)));
    }
    const satellite = frames.filter(frame => frame.source === "satellite");
    const rain = frames.filter(frame => frame.source === "rain");
    const peak = Math.max(...rain.map(frame => Math.max(...frame.values.map(value => value ?? 0))));
    const body = Buffer.from(JSON.stringify({
      id, region, bounds, rows, cols, coastline: await coastline(), satellite, rain,
    }));
    const version = sha256(body);
    const Bucket = "raw";
    const Key = `meteo/storm-replay/${version}/${id}.json`;
    const uri = `s3://${Bucket}/${Key}`;

    try {
      await s3.send(new PutObjectCommand({
        Bucket, Key, Body: body, ContentType: contentType, Metadata: { sha256: version }, IfNoneMatch: "*",
      }), { abortSignal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 412) throw error;
    }
    const verified = await s3.send(new GetObjectCommand({ Bucket, Key }), { abortSignal: AbortSignal.timeout(20_000) });
    if (!verified.Body || verified.ContentLength !== body.length ||
        sha256(await verified.Body.transformToByteArray()) !== version) {
      throw new Error("Stored replay differs from the downloaded sample");
    }
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE green_agent_ingest");
    await db.query("SET LOCAL statement_timeout = '15s'");
    await db.query(`INSERT INTO catalog.file_object (uri, sha256, size_bytes, content_type, retention_policy)
      VALUES ($1,$2,$3,$4,'source_version') ON CONFLICT DO NOTHING`, [uri, version, body.length, contentType]);
    await db.query(`INSERT INTO catalog.weather_replay
      (id, version, region, start_at, end_at, satellite_frames, rain_frames, peak_rain_rate, object_uri)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [id, version, region, epoch(start), epoch(end), satellite.length, rain.length, peak, uri]);
    const result = await db.query(`SELECT version FROM catalog.published_weather_replay
      WHERE id=$1 AND version=$2 AND object_uri=$3 AND sha256=$2 AND size_bytes=$4
        AND satellite_frames=$5 AND rain_frames=$6`, [id, version, uri, body.length, satellite.length, rain.length]);
    if (result.rowCount !== 1) throw new Error("Replay registration failed its consistency check");
    await db.query("COMMIT");
    console.log(JSON.stringify({ id, version, satelliteFrames: satellite.length, rainFrames: rain.length, bytes: body.length }));
  } finally {
    if (connected) await db.end();
    s3.destroy();
  }
}

await publish();
