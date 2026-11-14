import "server-only";

import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readDataAgent } from "@/lib/data-agent/database.server";

type ReplayRegistration = {
  object_uri: string;
  sha256: string;
  size_bytes: string;
};

let reader: S3Client | undefined;

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
      sources: ["SatWeave infrared brightness temperature", "PARDIG-NRT precipitation rate"],
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

export async function readWeatherReplay(id: string, version: string | null) {
  const record = await readDataAgent(async client => {
    const result = await client.query<ReplayRegistration>(`
      SELECT object_uri, sha256, size_bytes
      FROM catalog.published_weather_replay
      WHERE id = $1 AND ($2::text IS NULL OR version = $2)
      ORDER BY published_at DESC, version DESC LIMIT 1`, [id, version]);
    return result.rows[0];
  });

  if (!record) return null;
  const key = `meteo/storm-replay/${record.sha256}/${id}.json`;
  const size = Number(record.size_bytes);
  if (!/^[a-f0-9]{64}$/.test(record.sha256) || record.object_uri !== `s3://raw/${key}` ||
      !Number.isSafeInteger(size) || size < 1 || size > 2_000_000) {
    throw new Error("Invalid registered weather replay object");
  }
  const object = await storageReader().send(new GetObjectCommand({
    Bucket: "raw", Key: key,
  }), { abortSignal: AbortSignal.timeout(8000) });

  if (!object.Body || object.ContentLength !== size) {
    object.Body?.transformToWebStream().cancel().catch(() => {});
    throw new Error("Incomplete weather replay object");
  }
  const body = await object.Body.transformToByteArray();
  if (body.length !== size || createHash("sha256").update(body).digest("hex") !== record.sha256) {
    throw new Error("Invalid weather replay digest");
  }
  return { body: new TextDecoder().decode(body), version: record.sha256 };
}
