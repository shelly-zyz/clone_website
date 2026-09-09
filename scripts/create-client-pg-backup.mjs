#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(path.dirname(repoRoot), "outputs", "20260908-data-readiness", "backups");
const pgBin = "C:\\Program Files\\PostgreSQL\\17\\bin";
const pgDump = path.join(pgBin, "pg_dump.exe");
const pgRestore = path.join(pgBin, "pg_restore.exe");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is not configured.");
const databaseUrl = new URL(connectionString);
if (databaseUrl.pathname.replace(/^\//, "") !== "zyz") {
  throw new Error("Refusing to back up an unexpected database.");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${path.basename(command)} exited with ${code}`).trim()));
    });
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const executable of [pgDump, pgRestore]) {
    const info = await fs.stat(executable);
    if (!info.isFile()) throw new Error(`PostgreSQL tool is missing: ${executable}`);
  }

  const client = new pg.Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15_000,
    query_timeout: 60_000,
  });
  let identity;
  try {
    await client.connect();
    identity = (await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             host(inet_server_addr()) AS server_address,
             pg_database_size(current_database())::text AS database_bytes,
             pg_size_pretty(pg_database_size(current_database())) AS database_size
    `)).rows[0];
  } finally {
    await client.end().catch(() => {});
  }
  if (identity.database !== "zyz") throw new Error("Database identity changed during backup preflight.");

  const fileSystem = await fs.statfs(outputDirectory);
  const freeBytes = BigInt(fileSystem.bavail) * BigInt(fileSystem.bsize);
  const databaseBytes = BigInt(identity.database_bytes);
  const requiredBytes = databaseBytes + 5n * 1024n * 1024n * 1024n;
  if (freeBytes < requiredBytes) {
    throw new Error(`Insufficient free space: ${freeBytes} available, ${requiredBytes} required.`);
  }

  const backupId = `zyz-client-${new Date().toISOString().replaceAll(/[^0-9TZ]/g, "")}`;
  const partialPath = path.join(outputDirectory, `${backupId}.dump.part`);
  const finalPath = path.join(outputDirectory, `${backupId}.dump`);
  const reportPath = path.join(outputDirectory, `${backupId}.report.json`);
  const startedAt = new Date().toISOString();
  const environment = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGSSLMODE: process.env.DATABASE_SSL === "true" ? "require" : "disable",
  };
  const args = [
    "--format=custom",
    "--compress=zstd:1",
    "--no-password",
    "--host", databaseUrl.hostname,
    "--port", databaseUrl.port || "5432",
    "--username", decodeURIComponent(databaseUrl.username),
    "--dbname", "zyz",
    "--file", partialPath,
  ];

  console.log(JSON.stringify({
    status: "starting",
    database: identity.database,
    role: identity.role,
    serverAddress: identity.server_address,
    databaseSize: identity.database_size,
    freeGB: Number(freeBytes / (1024n * 1024n * 1024n)),
    partialPath,
  }));

  let progressTimer;
  try {
    progressTimer = setInterval(async () => {
      const bytes = (await fs.stat(partialPath).catch(() => null))?.size ?? 0;
      console.log(JSON.stringify({ status: "dumping", bytes, checkedAt: new Date().toISOString() }));
    }, 30_000);
    await run(pgDump, args, { cwd: repoRoot, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const report = {
      status: "failed",
      startedAt,
      failedAt: new Date().toISOString(),
      database: identity.database,
      role: identity.role,
      partialPath,
      error: error instanceof Error ? error.message : String(error),
    };
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    clearInterval(progressTimer);
    delete environment.PGPASSWORD;
  }

  const archive = await run(pgRestore, ["--list", partialPath], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const archiveEntries = archive.stdout.split(/\r?\n/).filter((line) => line && !line.startsWith(";")).length;
  if (archiveEntries === 0) throw new Error("pg_restore did not find any archive entries.");

  const file = await fs.stat(partialPath);
  const digest = await sha256(partialPath);
  await fs.rename(partialPath, finalPath);
  const report = {
    status: "complete",
    startedAt,
    finishedAt: new Date().toISOString(),
    database: identity.database,
    role: identity.role,
    serverAddress: identity.server_address,
    sourceDatabaseBytes: identity.database_bytes,
    sourceDatabaseSize: identity.database_size,
    file: finalPath,
    bytes: file.size,
    sha256: digest,
    archiveListReadable: true,
    archiveEntries,
    isolatedRestoreTest: false,
    note: "Archive list and SHA-256 passed. An isolated restore still requires PostgreSQL management privileges.",
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
