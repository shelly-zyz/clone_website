import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readDataAgent } from "@/lib/data-agent/database.server";
import { demoReplayId } from "./model";

type ReplayRegistration = {
  object_uri: string;
  sha256: string;
  size_bytes: string;
  body?: Buffer | null;
};

type ReplayContent = { body: string; version: string; source: "postgres" | "object-storage" | "bundled-archive" };
const bundledVersion = "db39d036034dcb896d3e3a76d711de0c84929d594b86b6845a78d54bd2b4e2e5";
const archiveFile = "public/data/weather-replay/us-southeast-2026-09-26-db39d036.json";
let reader: S3Client | undefined;
let lastObject: { key: string; size: number; content: ReplayContent } | undefined;
let bundledArchive: Promise<ReplayContent> | undefined;
let retryPayloadViewAt = 0;

function verifiedContent(bytes: Buffer, size: number, version: string, source: ReplayContent["source"]): ReplayContent {
  if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== version) {
    throw new Error("Invalid weather replay digest");
  }
  return { body: new TextDecoder().decode(bytes), version, source };
}

export async function readBundledReplay(id: string, version: string | null) {
  if (id !== demoReplayId || (version !== null && version !== bundledVersion)) return null;
  bundledArchive ??= readFile(join(process.cwd(), archiveFile))
    .then(bytes => verifiedContent(bytes, 488_445, bundledVersion, "bundled-archive"))
    .catch(error => { bundledArchive = undefined; throw error; });
  return bundledArchive;
}

function storageReader() {
  if (reader) return reader;
  const endpoint = process.env.WEATHER_REPLAY_S3_ENDPOINT;
  const accessKeyId = process.env.WEATHER_REPLAY_S3_ACCESS_KEY;
  const secretAccessKey = process.env.WEATHER_REPLAY_S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("Missing replay storage configuration");
  reader = new S3Client({
    endpoint, credentials: { accessKeyId, secretAccessKey }, region: "us-east-1", forcePathStyle: true,
  });
  return reader;
}

export async function listWeatherReplays(id?: string) {
  return readDataAgent(async client => {
    const result = await client.query<{
      id: string;
      version: string;
      region: string;
      start_at: Date;
      end_at: Date;
      satellite_frames: number;
      rain_frames: number;
      peak_rain_rate: string;
    }>(`SELECT id, version, region, start_at, end_at, satellite_frames, rain_frames, peak_rain_rate
      FROM catalog.published_weather_replay
      WHERE ($1::text IS NULL OR id = $1)
      ORDER BY published_at DESC, id, version DESC LIMIT 20`, [id ?? null]);
    return {
      sources: ["SatWeave infrared brightness temperature", "PARDIG-NRT precipitation rate", "NOAA GFS historical forecast"],
      peak_rain_rate_unit: "mm/h",
      replays: result.rows.map(row => ({
        ...row,
        start_at: row.start_at.toISOString(),
        end_at: row.end_at.toISOString(),
        peak_rain_rate: Number(row.peak_rain_rate),
        replay_path: `/visualization/weather-replay?id=${row.id}&version=${row.version}`,
      })),
    };
  });
}

function lookupReplay(id: string, version: string | null, withPayload: boolean) {
  // Both data sources are fixed views. The legacy catalog supports staggered deployment of the migration.
  const select = withPayload
    ? "SELECT object_uri, sha256, size_bytes, body FROM catalog.published_weather_replay_payload"
    : "SELECT object_uri, sha256, size_bytes FROM catalog.published_weather_replay";
  return readDataAgent(async client => {
    const result = await client.query<ReplayRegistration>(select + `
      WHERE id = $1 AND ($2::text IS NULL OR version = $2)
      ORDER BY published_at DESC, version DESC LIMIT 1`, [id, version]);
    return result.rows[0];
  });
}

async function readReplayRegistration(id: string, version: string | null) {
  if (Date.now() >= retryPayloadViewAt) {
    try {
      return await lookupReplay(id, version, true);
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42P01") throw error;
      retryPayloadViewAt = Date.now() + 30_000;
    }
  }
  return lookupReplay(id, version, false);
}

export async function readWeatherReplay(id: string, version: string | null) {
  const record = await readReplayRegistration(id, version);
  if (!record) return null;
  const key = `meteo/storm-replay/${record.sha256}/${id}.json`;
  const size = Number(record.size_bytes);
  if (!/^[a-f0-9]{64}$/.test(record.sha256) || record.object_uri !== `s3://raw/${key}` ||
      !Number.isSafeInteger(size) || size < 1 || size > 2_000_000) {
    throw new Error("Invalid registered weather replay object");
  }

  if (record.body) return verifiedContent(record.body, size, record.sha256, "postgres");
  const bundled = await readBundledReplay(id, record.sha256).catch(() => null);
  if (bundled) return bundled;

  // A published version is immutable. Retain its verified bytes for older registrations.
  if (lastObject?.key === key && lastObject.size === size) return lastObject.content;

  const chunkSize = 128 * 1024;
  const chunkCount = Math.ceil(size / chunkSize);
  const chunks = new Array<Buffer>(chunkCount);
  const requestSignal = AbortSignal.timeout(25_000);
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(size - 1, start + chunkSize - 1);
    const expectedLength = end - start + 1;
    const object = await storageReader().send(new GetObjectCommand({
      Bucket: "raw",
      Key: key,
      Range: "bytes=" + start + "-" + end,
    }), { abortSignal: requestSignal });

    if (!object.Body || object.ContentLength !== expectedLength
      || object.ContentRange !== "bytes " + start + "-" + end + "/" + size) {
      object.Body?.transformToWebStream().cancel().catch(() => {});
      throw new Error("Incomplete weather replay range");
    }
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length !== expectedLength) throw new Error("Incomplete weather replay range");
    chunks[index] = bytes;
  }
  const content = verifiedContent(Buffer.concat(chunks, size), size, record.sha256, "object-storage");
  lastObject = { key, size, content };
  return content;
}
