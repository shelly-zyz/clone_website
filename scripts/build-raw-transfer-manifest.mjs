#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.dirname(repo);
const dataRoot = path.join(workspace, "data");
const outputDirectory = path.join(workspace, "outputs/20260908-raw-archive-transfer");
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

const fixedFiles = [
  {
    name: "VRE_gfdl-esm4_ssp126_2021_2060.mat",
    group: "climate-vre",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/climate-vre/gfdl-esm4/ssp126",
    sourceName: "GFDL-ESM4 SSP126 VRE capacity factors",
    sourceUrl: "https://zenodo.org/records/17445329",
    databaseRelations: ["website_data.climate_vre_hourly"],
    truthStatus: "published-model-scenario-not-observation",
    compatibleEarths: ["weather-earth"],
  },
  {
    name: "china-260517.osm.pbf",
    group: "osm",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/osm/china/2026-05-17",
    sourceName: "OpenStreetMap China extract",
    sourceUrl: "https://download.geofabrik.de/asia/china.html",
    databaseRelations: ["website_data.geo_features", "website_data.vector_tiles"],
    truthStatus: "published-map-snapshot",
  },
  {
    name: "gem-data.zip",
    group: "energy-assets",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/energy-assets/gem/2026-02",
    sourceName: "Global Energy Monitor power trackers",
    sourceUrl: "https://globalenergymonitor.org/projects/",
    databaseRelations: ["website_data.energy_assets"],
    truthStatus: "published-project-registry",
  },
  {
    name: "globalpowerplantdatabasev130.zip",
    group: "energy-assets",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/energy-assets/wri/gppd-v1.3.0",
    sourceName: "WRI Global Power Plant Database v1.3.0",
    sourceUrl: "https://github.com/wri/global-power-plant-database",
    databaseRelations: ["website_data.energy_assets"],
    truthStatus: "published-project-registry",
  },
  {
    name: "China Hydropower Station Dataset.zip",
    group: "energy-assets",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/energy-assets/hydropower/china",
    sourceName: "China Hydropower Station Dataset",
    sourceUrl: "https://data.mendeley.com/",
    databaseRelations: ["website_data.energy_assets"],
    truthStatus: "published-project-registry-version-link-pending",
  },
  {
    name: "14526360.zip",
    group: "energy-assets",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/energy-assets/hydropower/glohydrores",
    sourceName: "GloHydroRes archive",
    sourceUrl: "https://zenodo.org/records/14526360",
    databaseRelations: ["website_data.energy_assets"],
    truthStatus: "published-project-registry",
  },
  {
    name: "CPVPD-2024.zip",
    group: "solar-footprints",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/solar-footprints/cpvpd-2024",
    sourceName: "CPVPD-2024 photovoltaic footprints",
    sourceUrl: "https://zenodo.org/records/15618227",
    databaseRelations: ["website_data.json_documents"],
    truthStatus: "published-earth-observation-derived-footprints",
  },
  {
    name: "14292571.zip",
    group: "solar-footprints",
    earthLayer: "power-earth",
    targetDirectory: "power-earth/solar-footprints/chinapv-2015-2020",
    sourceName: "ChinaPV 2015/2020 photovoltaic footprints",
    sourceUrl: "https://zenodo.org/records/14292571",
    databaseRelations: ["website_data.json_documents"],
    truthStatus: "published-earth-observation-derived-footprints",
  },
];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${fullPath}`);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
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
  const sourceRows = (
    await client.query(`
      SELECT path,size_bytes,sha256,import_status
      FROM website_data.source_files
      WHERE path LIKE 'data/carbon-graced/%' OR dataset='power-source'
    `)
  ).rows;
  const sourceIndex = new Map(sourceRows.map((row) => [row.path.replaceAll("\\", "/"), row]));
  const items = [];
  const carbonRoot = path.join(dataRoot, "carbon-graced");
  for (const localPath of await walk(carbonRoot)) {
    const relative = path.relative(workspace, localPath).replaceAll("\\", "/");
    const source = sourceIndex.get(relative);
    const stat = await fs.stat(localPath);
    const subpath = path.relative(carbonRoot, localPath).replaceAll("\\", "/");
    items.push({
      assetKey: `carbon-graced-power:${subpath}`,
      group: "graced-power",
      earthLayer: "carbon-earth",
      sourceName: "Carbon Monitor GRACED Power",
      sourceUrl: "https://carbonmonitor-graced.com/",
      localPath,
      localRelativePath: relative,
      serverPath: `D:/energy-platform-data/raw/carbon-earth/graced-power/${subpath}`,
      fileName: path.basename(localPath),
      mediaType: path.extname(localPath).toLowerCase().slice(1) || "binary",
      sizeBytes: stat.size,
      sha256: source?.sha256 ?? null,
      priorDatabaseFileStatus: source?.import_status ?? null,
      databaseRelations: [
        "website_data.carbon_source_archives",
        "website_data.carbon_emission_frames",
      ],
      truthStatus: "published-emission-estimate-not-direct-observation",
    });
  }
  for (const definition of fixedFiles) {
    const localPath = path.join(dataRoot, definition.name);
    const relative = path.relative(workspace, localPath).replaceAll("\\", "/");
    const source = sourceIndex.get(relative);
    const stat = await fs.stat(localPath);
    items.push({
      assetKey: `${definition.group}:${definition.name}`,
      ...definition,
      localPath,
      localRelativePath: relative,
      serverPath: `D:/energy-platform-data/raw/${definition.targetDirectory}/${definition.name}`,
      fileName: definition.name,
      mediaType: path.extname(definition.name).toLowerCase().slice(1) || "binary",
      sizeBytes: stat.size,
      sha256: source?.sha256 ?? null,
      priorDatabaseFileStatus: source?.import_status ?? null,
    });
  }
  const missingHash = items.filter((item) => !/^[0-9a-f]{64}$/i.test(item.sha256 ?? ""));
  const sizeMismatch = items.filter((item) => {
    const source = sourceIndex.get(item.localRelativePath);
    return !source || Number(source.size_bytes) !== item.sizeBytes;
  });
  const duplicateTargets = items.filter(
    (item, index) => items.findIndex((other) => other.serverPath === item.serverPath) !== index,
  );
  const groups = Object.values(
    items.reduce((result, item) => {
      result[item.group] ??= { group: item.group, files: 0, bytes: 0 };
      result[item.group].files += 1;
      result[item.group].bytes += item.sizeBytes;
      return result;
    }, {}),
  );
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceComputer: process.env.COMPUTERNAME,
    targetComputer: "DESKTOP-OLMIC7I",
    targetRoot: "D:/energy-platform-data/raw",
    policy: {
      copyOnly: true,
      deleteSourceAfterCopy: false,
      requireSizeAndSha256Match: true,
      overwriteExistingTarget: false,
    },
    totals: {
      files: items.length,
      bytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
      missingHashes: missingHash.length,
      sizeMismatches: sizeMismatch.length,
      duplicateTargets: duplicateTargets.length,
    },
    groups,
    items,
  };
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "raw-transfer-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ...manifest, items: undefined }, null, 2));
  if (missingHash.length || sizeMismatch.length || duplicateTargets.length) process.exitCode = 1;
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
