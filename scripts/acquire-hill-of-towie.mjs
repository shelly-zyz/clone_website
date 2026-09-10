#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const manifestPath = path.resolve(scriptDir, "../docs/project-management/forecast-sources/hill-of-towie.json");
export const defaultOutputDir = path.resolve(scriptDir, "../.forecast-data/hill-of-towie");

export function parseArguments(args) {
  const options = { includeShutdowns: false, years: [], outputDir: defaultOutputDir };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--include-shutdowns") options.includeShutdowns = true;
    else if (argument === "--year") options.years.push(Number(args[++index]));
    else if (argument === "--output") options.outputDir = path.resolve(args[++index] ?? "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.years.some((year) => !Number.isInteger(year))) throw new Error("--year requires an integer year");
  return options;
}

export function selectFiles(manifest, options) {
  const requestedYears = new Set(options.years ?? []);
  const knownYears = new Set(manifest.files.filter((file) => file.kind === "scada").map((file) => file.year));
  for (const year of requestedYears) {
    if (!knownYears.has(year)) throw new Error(`Year ${year} is not present in the pinned source manifest`);
  }
  return manifest.files.filter((file) => (
    file.kind === "metadata"
    || (file.kind === "shutdown" && options.includeShutdowns)
    || (file.kind === "scada" && requestedYears.has(file.year))
  ));
}

export function assertDestinationInside(outputDir, fileName) {
  if (path.basename(fileName) !== fileName) throw new Error(`Unsafe source filename: ${fileName}`);
  const root = path.resolve(outputDir);
  const destination = path.resolve(root, fileName);
  if (path.dirname(destination) !== root) throw new Error(`Destination escapes output directory: ${fileName}`);
  return destination;
}

export async function checksum(filePath, algorithm = "md5") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function sourceUrl(manifest, file) {
  return `${manifest.recordUrl}/files/${encodeURIComponent(file.name)}?download=1`;
}

async function downloadFile(manifest, file, outputDir, fetchImpl = fetch) {
  const destination = assertDestinationInside(outputDir, file.name);
  const partial = `${destination}.part`;
  try {
    const existing = await stat(destination).catch(() => null);
    if (existing && existing.size <= file.maxBytes && await checksum(destination) === file.md5) {
      return { id: file.id, name: file.name, bytes: existing.size, md5: file.md5, status: "verified-existing" };
    }

    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const timeoutMs = file.kind === "scada" ? 4 * 60 * 60 * 1_000 : 20_000;
        const response = await fetchImpl(sourceUrl(manifest, file), {
          headers: { "user-agent": "OpenGridWorks forecast-data acquisition/1.0" },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > file.maxBytes) throw new Error(`file exceeds ${file.maxBytes} byte safety limit`);
        let receivedBytes = 0;
        let nextProgressBytes = 100 * 1024 * 1024;
        const progress = new Transform({
          transform(chunk, _encoding, callback) {
            receivedBytes += chunk.length;
            if (file.kind === "scada" && receivedBytes >= nextProgressBytes) {
              console.error(`${file.name}: downloaded ${Math.floor(receivedBytes / 1024 / 1024)} MiB`);
              nextProgressBytes += 100 * 1024 * 1024;
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial));
        const downloaded = await stat(partial);
        if (downloaded.size > file.maxBytes) throw new Error(`file exceeds ${file.maxBytes} byte safety limit`);
        const actualMd5 = await checksum(partial);
        if (actualMd5 !== file.md5) throw new Error(`MD5 mismatch: expected ${file.md5}, received ${actualMd5}`);
        await rename(partial, destination);
        return { id: file.id, name: file.name, bytes: downloaded.size, md5: actualMd5, status: "downloaded-verified" };
      } catch (error) {
        lastError = error;
        await unlink(partial).catch(() => {});
      }
    }
    throw new Error(`${file.name}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  } finally {
    await unlink(partial).catch(() => {});
  }
}

export async function acquire(options, dependencies = {}) {
  const manifest = JSON.parse(await readFile(dependencies.manifestPath ?? manifestPath, "utf8"));
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir);
  await mkdir(outputDir, { recursive: true });
  const selected = selectFiles(manifest, options);
  const files = [];
  for (const file of selected) files.push(await downloadFile(manifest, file, outputDir, dependencies.fetchImpl));

  const acquiredKinds = new Set(selected.map((file) => file.kind));
  const status = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { id: manifest.id, name: manifest.name, doi: manifest.doi, recordUrl: manifest.recordUrl, license: manifest.license },
    acquisition: {
      status: acquiredKinds.has("scada") ? "source-files-verified" : "metadata-verified",
      outputDir,
      files,
    },
    productionGate: {
      unlocked: false,
      blockers: [
        ...(acquiredKinds.has("scada") ? [] : ["No annual SCADA archive has been explicitly selected and acquired."]),
        "Historical NWP with issue time and valid time has not been paired to observations.",
        "Curtailment is not explicitly identified by this source and must not be inferred from shutdown duration alone.",
        "The native 10-minute observations must be aggregated and validated before entering the current 60-minute training contract."
      ]
    }
  };
  await writeFile(path.join(outputDir, "acquisition-status.json"), `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return status;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await acquire(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
