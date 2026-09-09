#!/usr/bin/env node

import crypto from "node:crypto";
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
const progressPath = path.join(outputDirectory, "raw-transfer-upload-progress.json");

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
  limit: args.has("limit") ? Number(args.get("limit")) : null,
  offset: args.has("offset") ? Number(args.get("offset")) : 0,
  verifyOnly: args.has("verify-only"),
  dryRun: args.has("dry-run"),
  skipDb: args.has("skip-db"),
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

function run(command, commandArgs, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
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

function remotePath(value) {
  return value.replaceAll("\\", "/");
}

function parentDirectory(value) {
  const normalized = remotePath(value);
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

async function statRemote(filePath) {
  const code = `
$ErrorActionPreference='Stop'
$path=${psQuote(remotePath(filePath))}
if (Test-Path -LiteralPath $path -PathType Leaf) {
  $item=Get-Item -LiteralPath $path
  $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  [pscustomobject]@{exists=$true;size=[Int64]$item.Length;sha256=$hash}|ConvertTo-Json -Compress
} else {
  [pscustomobject]@{exists=$false}|ConvertTo-Json -Compress
}
`;
  return remoteJson(code);
}

async function ensureRemoteDirectory(directory) {
  const code = `
$ErrorActionPreference='Stop'
$dir=${psQuote(remotePath(directory))}
if (!$dir.StartsWith('D:/energy-platform-data/raw/')) { throw "Refusing path outside raw root: $dir" }
[IO.Directory]::CreateDirectory($dir)|Out-Null
[pscustomobject]@{ok=$true;dir=$dir}|ConvertTo-Json -Compress
`;
  return remoteJson(code);
}

async function movePartIntoPlace(partPath, finalPath) {
  const code = `
$ErrorActionPreference='Stop'
$part=${psQuote(remotePath(partPath))}
$final=${psQuote(remotePath(finalPath))}
if (!$part.StartsWith('D:/energy-platform-data/raw/') -or !$final.StartsWith('D:/energy-platform-data/raw/')) { throw 'Refusing path outside raw root' }
if (!(Test-Path -LiteralPath $part -PathType Leaf)) { throw "Missing uploaded temp file: $part" }
if (Test-Path -LiteralPath $final -PathType Leaf) { throw "Final file already exists: $final" }
Move-Item -LiteralPath $part -Destination $final
[pscustomobject]@{ok=$true;path=$final}|ConvertTo-Json -Compress
`;
  return remoteJson(code);
}

async function uploadFile(localPath, serverPath) {
  const localForSftp = localPath.replaceAll("\\", "/");
  const partPath = `${remotePath(serverPath)}.part`;
  const batch = `put "${localForSftp}" "${partPath}"\n`;
  await run("sftp", ["-b", "-", "-P", String(options.port), ...sshOptions, remote], batch);
  return partPath;
}

async function markAsset(client, item, status, error = null) {
  if (!client) return;
  await client.query(
    `
      UPDATE website_data.raw_file_assets
      SET storage_status=$2,
          copied_at=CASE WHEN $2 IN ('transferring','verified') THEN coalesce(copied_at,now()) ELSE copied_at END,
          verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END,
          error=$3,
          updated_at=now()
      WHERE asset_key=$1
    `,
    [item.assetKey, status, error],
  );
}

async function writeProgress(progress) {
  await fsp.writeFile(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
}

async function main() {
  if (!fs.existsSync(options.key)) throw new Error(`Missing SSH key: ${options.key}`);
  if (!fs.existsSync(options.knownHosts)) throw new Error(`Missing known_hosts file: ${options.knownHosts}`);

  const manifest = JSON.parse(await fsp.readFile(options.manifest, "utf8"));
  let items = manifest.items;
  if (options.group) items = items.filter((item) => item.group === options.group);
  items = items.slice(options.offset, options.limit ? options.offset + options.limit : undefined);

  const client =
    options.skipDb || options.dryRun
      ? null
      : new pg.Client({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 10_000,
          query_timeout: 60_000,
          application_name: "raw-file-sftp-transfer",
        });
  if (client) await client.connect();

  const progress = {
    startedAt: new Date().toISOString(),
    mode: options.verifyOnly ? "verify-only" : options.dryRun ? "dry-run" : "transfer",
    group: options.group,
    offset: options.offset,
    limit: options.limit,
    totalItems: items.length,
    checked: 0,
    skippedVerified: 0,
    uploaded: 0,
    verified: 0,
    failed: 0,
    lastAssetKey: null,
    lastError: null,
  };
  await writeProgress(progress);

  try {
    for (const item of items) {
      progress.checked += 1;
      progress.lastAssetKey = item.assetKey;
      const localHash = item.sha256.toLowerCase();
      const finalPath = remotePath(item.serverPath);
      try {
        if (options.dryRun) {
          console.log(`[dry-run] ${item.group} ${item.localPath} -> ${finalPath}`);
          continue;
        }

        const existing = await statRemote(finalPath);
        if (existing.exists) {
          if (Number(existing.size) === Number(item.sizeBytes) && existing.sha256 === localHash) {
            progress.skippedVerified += 1;
            progress.verified += 1;
            await markAsset(client, item, "verified");
            console.log(`[verified-existing] ${item.assetKey}`);
            continue;
          }
          throw new Error(
            `Remote file exists but differs: size=${existing.size}, sha256=${existing.sha256}, expected=${item.sizeBytes}/${localHash}`,
          );
        }

        if (options.verifyOnly) {
          await markAsset(client, item, "planned", "Remote file is not present.");
          console.log(`[missing] ${item.assetKey}`);
          continue;
        }

        await markAsset(client, item, "transferring");
        await ensureRemoteDirectory(parentDirectory(finalPath));
        const partPath = await uploadFile(item.localPath, finalPath);
        const uploaded = await statRemote(partPath);
        if (!uploaded.exists || Number(uploaded.size) !== Number(item.sizeBytes) || uploaded.sha256 !== localHash) {
          throw new Error(
            `Uploaded temp verification failed: size=${uploaded.size}, sha256=${uploaded.sha256}, expected=${item.sizeBytes}/${localHash}`,
          );
        }
        await movePartIntoPlace(partPath, finalPath);
        const final = await statRemote(finalPath);
        if (!final.exists || Number(final.size) !== Number(item.sizeBytes) || final.sha256 !== localHash) {
          throw new Error(
            `Final verification failed: size=${final.size}, sha256=${final.sha256}, expected=${item.sizeBytes}/${localHash}`,
          );
        }
        progress.uploaded += 1;
        progress.verified += 1;
        await markAsset(client, item, "verified");
        console.log(`[uploaded-verified] ${item.assetKey}`);
      } catch (error) {
        progress.failed += 1;
        progress.lastError = error.message;
        await markAsset(client, item, "failed", error.message.slice(0, 1000)).catch(() => {});
        await writeProgress(progress);
        throw error;
      }
      await writeProgress(progress);
    }
  } finally {
    progress.finishedAt = new Date().toISOString();
    await writeProgress(progress);
    await client?.end().catch(() => {});
  }

  console.log(JSON.stringify(progress, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
