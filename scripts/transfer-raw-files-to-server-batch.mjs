#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });

const outputDirectory = path.join(path.dirname(repo), "outputs/20260908-raw-archive-transfer");
const defaultManifest = path.join(outputDirectory, "raw-transfer-manifest.json");
const defaultKnownHosts = path.join(outputDirectory, "windows-server-2222-known-hosts");
const defaultKey = path.join(outputDirectory, "private-config-v2/raw-transfer-v2-ed25519");
const progressPath = path.join(outputDirectory, "raw-transfer-batch-progress.json");
const remoteWorkDirectory = "D:/energy-platform-data/raw/shared/raw-transfer-work";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=", 2);
  const value = inlineValue ?? (process.argv[index + 1]?.startsWith("--") ? "true" : process.argv[++index]);
  args.set(key, value ?? "true");
}

const options = {
  host: args.get("host") ?? "218.197.118.49",
  port: Number(args.get("port") ?? 2222),
  user: args.get("user") ?? "administrator",
  key: path.resolve(args.get("key") ?? defaultKey),
  knownHosts: path.resolve(args.get("known-hosts") ?? defaultKnownHosts),
  manifest: path.resolve(args.get("manifest") ?? defaultManifest),
  group: args.get("group") ?? null,
  maxFiles: Number(args.get("max-files") ?? 200),
  maxBytes: Number(args.get("max-bytes") ?? 2_147_483_648),
  limit: args.has("limit") ? Number(args.get("limit")) : null,
  offset: args.has("offset") ? Number(args.get("offset")) : 0,
};

const sshOptions = [
  "-i",
  options.key,
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  `UserKnownHostsFile=${options.knownHosts}`,
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "BatchMode=yes",
];
const remote = `${options.user}@${options.host}`;

function run(command, commandArgs, input, stream = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (stream) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stream) process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`${command} exited ${code}: ${stderr || stdout}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
    child.stdin.end(input ?? "");
  });
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function encodePowerShell(code) {
  return Buffer.from(code, "utf16le").toString("base64");
}

function toSftpPath(value) {
  return String(value).replaceAll("\\", "/");
}

function parentDirectory(value) {
  const normalized = toSftpPath(value);
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

async function remoteJson(code) {
  const { stdout } = await run("ssh", [
    "-p",
    String(options.port),
    ...sshOptions,
    remote,
    "powershell.exe",
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodePowerShell(code),
  ]);
  return JSON.parse(stdout.trim());
}

async function ensureRemoteWorkDirectory() {
  return remoteJson(`
$ErrorActionPreference='Stop'
$dir=${psQuote(remoteWorkDirectory)}
[IO.Directory]::CreateDirectory($dir)|Out-Null
[pscustomobject]@{ok=$true;dir=$dir;free=(Get-PSDrive D).Free}|ConvertTo-Json -Compress
`);
}

async function ensureRemoteDirectories(directories) {
  const unique = [...new Set(directories.map(toSftpPath))];
  const values = unique.map(psQuote).join(",");
  return remoteJson(`
$ErrorActionPreference='Stop'
$dirs=@(${values})
foreach($dir in $dirs){
  if(!$dir.StartsWith('D:/energy-platform-data/raw/')){throw "Refusing path outside raw root: $dir"}
  [IO.Directory]::CreateDirectory($dir)|Out-Null
}
[pscustomobject]@{ok=$true;directories=$dirs.Count}|ConvertTo-Json -Compress
`);
}

async function fetchVerifiedAssetKeys(client, items) {
  const result = await client.query(
    `
      SELECT asset_key
      FROM website_data.raw_file_assets
      WHERE asset_key = ANY($1::text[]) AND storage_status = 'verified'
    `,
    [items.map((item) => item.assetKey)],
  );
  return new Set(result.rows.map((row) => row.asset_key));
}

function makeBatches(items) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const item of items) {
    const size = Number(item.sizeBytes);
    if (current.length > 0 && (current.length >= options.maxFiles || bytes + size > options.maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function writeProgress(progress) {
  await fsp.writeFile(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
}

async function writeLocalChunkManifest(batchNumber, items) {
  const filePath = path.join(outputDirectory, `raw-transfer-chunk-${String(batchNumber).padStart(4, "0")}.json`);
  const body = {
    generatedAt: new Date().toISOString(),
    batchNumber,
    items: items.map((item) => ({
      assetKey: item.assetKey,
      serverPath: toSftpPath(item.serverPath),
      sizeBytes: Number(item.sizeBytes),
      sha256: item.sha256.toLowerCase(),
    })),
  };
  await fsp.writeFile(filePath, `${JSON.stringify(body)}\n`);
  return filePath;
}

function buildSftpBatch(localManifestPath, remoteManifestPath, items) {
  const lines = [];
  lines.push(`put "${toSftpPath(localManifestPath)}" "${remoteManifestPath}"`);
  for (const item of items) {
    lines.push(`put "${toSftpPath(item.localPath)}" "${toSftpPath(item.serverPath)}.part"`);
  }
  return `${lines.join("\n")}\n`;
}

async function verifyRemoteChunk(remoteManifestPath) {
  const code = `
$ErrorActionPreference='Stop'
$manifest=Get-Content -Raw -LiteralPath ${psQuote(remoteManifestPath)} | ConvertFrom-Json
$results=New-Object System.Collections.Generic.List[object]
foreach($item in $manifest.items){
  $assetKey=[string]$item.assetKey
  $final=[string]$item.serverPath
  $part="$final.part"
  $expectedSize=[Int64]$item.sizeBytes
  $expectedHash=([string]$item.sha256).ToLowerInvariant()
  try{
    if(!$final.StartsWith('D:/energy-platform-data/raw/')){throw "Refusing path outside raw root: $final"}
    if(Test-Path -LiteralPath $final -PathType Leaf){
      $file=Get-Item -LiteralPath $final
      $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $final).Hash.ToLowerInvariant()
      if([Int64]$file.Length -eq $expectedSize -and $hash -eq $expectedHash){
        $results.Add([pscustomobject]@{assetKey=$assetKey;status='verified';mode='existing';size=[Int64]$file.Length;sha256=$hash;error=$null})
      }else{
        $results.Add([pscustomobject]@{assetKey=$assetKey;status='failed';mode='existing-mismatch';size=[Int64]$file.Length;sha256=$hash;error='Remote final file exists but differs'})
      }
    }elseif(Test-Path -LiteralPath $part -PathType Leaf){
      $file=Get-Item -LiteralPath $part
      $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $part).Hash.ToLowerInvariant()
      if([Int64]$file.Length -eq $expectedSize -and $hash -eq $expectedHash){
        Move-Item -LiteralPath $part -Destination $final
        $results.Add([pscustomobject]@{assetKey=$assetKey;status='verified';mode='uploaded';size=[Int64]$file.Length;sha256=$hash;error=$null})
      }else{
        $results.Add([pscustomobject]@{assetKey=$assetKey;status='failed';mode='part-mismatch';size=[Int64]$file.Length;sha256=$hash;error='Uploaded part file differs'})
      }
    }else{
      $results.Add([pscustomobject]@{assetKey=$assetKey;status='failed';mode='missing';size=$null;sha256=$null;error='Uploaded part file is missing'})
    }
  }catch{
    $results.Add([pscustomobject]@{assetKey=$assetKey;status='failed';mode='exception';size=$null;sha256=$null;error=$_.Exception.Message})
  }
}
[pscustomobject]@{checked=$results.Count;results=$results}|ConvertTo-Json -Depth 8 -Compress
`;
  return remoteJson(code);
}

async function updateDatabase(client, verification) {
  const rows = verification.results.map((result) => ({
    asset_key: result.assetKey,
    storage_status: result.status,
    error: result.error ?? null,
    mode: result.mode ?? null,
    remote_size: result.size ?? null,
    remote_sha256: result.sha256 ?? null,
  }));
  await client.query(
    `
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb)
        AS x(asset_key text, storage_status text, error text, mode text, remote_size bigint, remote_sha256 text)
      )
      UPDATE website_data.raw_file_assets a
      SET storage_status = incoming.storage_status,
          copied_at = CASE WHEN incoming.storage_status='verified' THEN coalesce(a.copied_at, now()) ELSE a.copied_at END,
          verified_at = CASE WHEN incoming.storage_status='verified' THEN now() ELSE a.verified_at END,
          error = incoming.error,
          metadata = a.metadata || jsonb_build_object(
            'lastTransferMode', incoming.mode,
            'lastRemoteSize', incoming.remote_size,
            'lastRemoteSha256', incoming.remote_sha256
          ),
          updated_at = now()
      FROM incoming
      WHERE a.asset_key = incoming.asset_key
    `,
    [JSON.stringify(rows)],
  );
}

async function main() {
  if (!fs.existsSync(options.key)) throw new Error(`Missing SSH key: ${options.key}`);
  if (!fs.existsSync(options.knownHosts)) throw new Error(`Missing known_hosts file: ${options.knownHosts}`);

  const manifest = JSON.parse(await fsp.readFile(options.manifest, "utf8"));
  let items = manifest.items;
  if (options.group) items = items.filter((item) => item.group === options.group);
  items = items.slice(options.offset, options.limit ? options.offset + options.limit : undefined);

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 120_000,
    application_name: "raw-file-sftp-batch-transfer",
  });
  await client.connect();

  const remoteReady = await ensureRemoteWorkDirectory();
  const verified = await fetchVerifiedAssetKeys(client, items);
  const pending = items.filter((item) => !verified.has(item.assetKey));
  const batches = makeBatches(pending);
  const progress = {
    startedAt: new Date().toISOString(),
    group: options.group,
    selectedItems: items.length,
    alreadyVerified: verified.size,
    pendingItems: pending.length,
    remoteFreeBytesAtStart: remoteReady.free,
    batches: batches.length,
    completedBatches: 0,
    uploadedFiles: 0,
    verifiedFiles: verified.size,
    failedFiles: 0,
    lastBatch: null,
    lastError: null,
  };
  await writeProgress(progress);

  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batchNumber = index + 1;
      const batch = batches[index];
      const localManifestPath = await writeLocalChunkManifest(batchNumber, batch);
      const remoteManifestPath = `${remoteWorkDirectory}/raw-transfer-chunk-${String(batchNumber).padStart(4, "0")}.json`;
      const batchBytes = batch.reduce((sum, item) => sum + Number(item.sizeBytes), 0);
      progress.lastBatch = { batchNumber, files: batch.length, bytes: batchBytes };
      await writeProgress(progress);
      console.log(`[batch-start] ${batchNumber}/${batches.length} files=${batch.length} bytes=${batchBytes}`);
      await ensureRemoteDirectories([remoteWorkDirectory, ...batch.map((item) => parentDirectory(item.serverPath))]);
      await run(
        "sftp",
        ["-q", "-b", "-", "-P", String(options.port), ...sshOptions, remote],
        buildSftpBatch(localManifestPath, remoteManifestPath, batch),
        false,
      );
      const verification = await verifyRemoteChunk(remoteManifestPath);
      await updateDatabase(client, verification);
      const ok = verification.results.filter((result) => result.status === "verified").length;
      const failed = verification.results.length - ok;
      progress.completedBatches += 1;
      progress.uploadedFiles += batch.length;
      progress.verifiedFiles += ok;
      progress.failedFiles += failed;
      if (failed > 0) {
        progress.lastError = `Batch ${batchNumber} had ${failed} failed files.`;
        await writeProgress(progress);
        throw new Error(progress.lastError);
      }
      console.log(`[batch-verified] ${batchNumber}/${batches.length} verified=${ok}`);
      await writeProgress(progress);
    }
  } finally {
    progress.finishedAt = new Date().toISOString();
    await writeProgress(progress);
    await client.end().catch(() => {});
  }

  console.log(JSON.stringify(progress, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
