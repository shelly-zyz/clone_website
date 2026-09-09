#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(path.dirname(repo), "outputs/20260908-raw-archive-transfer");
const manifestPath = path.join(outputDirectory, "raw-transfer-manifest.json");
const checkpointPath = path.join(outputDirectory, "computed-missing-hashes.json");
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
const pending = manifest.items.filter((item) => !/^[0-9a-f]{64}$/i.test(item.sha256 ?? ""));
let checkpoint = { startedAt: new Date().toISOString(), completed: {} };
try {
  checkpoint = JSON.parse(await fsp.readFile(checkpointPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const results = [];
for (const [index, item] of pending.entries()) {
  const stat = await fsp.stat(item.localPath);
  if (stat.size !== item.sizeBytes) throw new Error(`Size changed: ${item.localPath}`);
  const cached = checkpoint.completed[item.localRelativePath];
  const sha256 =
    cached?.sizeBytes === item.sizeBytes && /^[0-9a-f]{64}$/i.test(cached.sha256)
      ? cached.sha256
      : await hashFile(item.localPath);
  results.push({ path: item.localRelativePath, sizeBytes: item.sizeBytes, sha256 });
  checkpoint.completed[item.localRelativePath] = {
    sizeBytes: item.sizeBytes,
    sha256,
    checkedAt: new Date().toISOString(),
  };
  checkpoint.updatedAt = new Date().toISOString();
  await fsp.writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  console.log(`[${index + 1}/${pending.length}] ${item.fileName} ${sha256}`);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('opengridworks-raw-file-hashes'))");
  for (const result of results) {
    const updated = await client.query(
      `UPDATE website_data.source_files
       SET sha256=$1
       WHERE path=$2 AND size_bytes=$3 AND sha256 IS NULL
       RETURNING path`,
      [result.sha256, result.path, result.sizeBytes],
    );
    if (updated.rowCount !== 1) {
      const current = await client.query(
        "SELECT sha256,size_bytes FROM website_data.source_files WHERE path=$1",
        [result.path],
      );
      if (
        current.rowCount !== 1 ||
        current.rows[0].sha256 !== result.sha256 ||
        Number(current.rows[0].size_bytes) !== result.sizeBytes
      ) {
        throw new Error(`Database source row changed: ${result.path}`);
      }
    }
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}

checkpoint.finishedAt = new Date().toISOString();
checkpoint.databaseRowsUpdated = results.length;
await fsp.writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
console.log(JSON.stringify({ complete: true, files: results.length, checkpointPath }, null, 2));
