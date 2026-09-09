#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(path.dirname(repo), "outputs/20260908-raw-archive-transfer");
const resultPath = path.join(outputDirectory, "server-raw-archive-preparation.json");
const targetRoot = "D:/energy-platform-data/raw";
const directories = [
  targetRoot,
  `${targetRoot}/carbon-earth/graced-power`,
  `${targetRoot}/power-earth/climate-vre/gfdl-esm4/ssp126`,
  `${targetRoot}/power-earth/osm/china/2026-05-17`,
  `${targetRoot}/power-earth/energy-assets/gem/2026-02`,
  `${targetRoot}/power-earth/energy-assets/wri/gppd-v1.3.0`,
  `${targetRoot}/power-earth/energy-assets/hydropower/china`,
  `${targetRoot}/power-earth/energy-assets/hydropower/glohydrores`,
  `${targetRoot}/power-earth/solar-footprints/cpvpd-2024`,
  `${targetRoot}/power-earth/solar-footprints/chinapv-2015-2020`,
  `${targetRoot}/weather-earth/climate-projection/gfdl-esm4/ssp126`,
  `${targetRoot}/shared`,
];

const options = {
  host: "218.197.118.49",
  port: 5432,
  database: "zyz",
  ssl: false,
  connectionTimeoutMillis: 15_000,
  query_timeout: 120_000,
  keepAlive: true,
};
const admin = new pg.Client({ ...options, user: "postgres", password: process.env.MIGRATION_ADMIN_PASSWORD });
const app = new pg.Client({ ...options, user: "zyz", password: process.env.MIGRATION_APP_PASSWORD });
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const program = (code) =>
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " +
  Buffer.from(code, "utf16le").toString("base64");

try {
  await admin.connect();
  await app.connect();
  const [adminIdentity, appIdentity] = await Promise.all([
    admin.query("SELECT current_database() db,current_user role,host(inet_server_addr()) host,version()"),
    app.query("SELECT current_database() db,current_user role,host(inet_server_addr()) host"),
  ]);
  if (
    adminIdentity.rows[0].db !== "zyz" ||
    adminIdentity.rows[0].role !== "postgres" ||
    adminIdentity.rows[0].host !== "218.197.118.49" ||
    !adminIdentity.rows[0].version.includes("windows") ||
    appIdentity.rows[0].role !== "zyz"
  ) {
    throw new Error("Target identity mismatch.");
  }
  const directoryArray = directories.map((directory) => literal(directory)).join(",");
  const code = `$ErrorActionPreference='Stop';$paths=@(${directoryArray});foreach($path in $paths){if(!$path.StartsWith('${targetRoot}/') -and $path -ne '${targetRoot}'){throw 'Path outside fixed root'};[IO.Directory]::CreateDirectory($path)|Out-Null;$node=[IO.DirectoryInfo]$path;while($null -ne $node){if($node.Exists -and (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw ('Reparse point: '+$node.FullName)};$node=$node.Parent}};@{computer=$env:COMPUTERNAME;root='${targetRoot}';directories=@($paths|ForEach-Object{@{path=$_;exists=(Test-Path -LiteralPath $_)}});driveFree=(Get-PSDrive D).Free}|ConvertTo-Json -Depth 6 -Compress`;
  await admin.query("CREATE TEMP TABLE raw_archive_prepare_output(value text);TRUNCATE raw_archive_prepare_output");
  await admin.query(`COPY raw_archive_prepare_output FROM PROGRAM ${literal(program(code))}`);
  const rows = (await admin.query("SELECT value FROM raw_archive_prepare_output")).rows;
  if (rows.length !== 1) throw new Error("Unexpected server directory result.");
  const server = JSON.parse(rows[0].value);
  if (
    server.computer !== "DESKTOP-OLMIC7I" ||
    server.directories.length !== directories.length ||
    server.directories.some((directory) => !directory.exists)
  ) {
    throw new Error("Server directories were not fully created.");
  }

  await app.query("BEGIN");
  await app.query(`
    CREATE TABLE IF NOT EXISTS website_data.raw_file_assets (
      asset_key text PRIMARY KEY,
      transfer_batch text NOT NULL,
      earth_layer text NOT NULL,
      dataset_group text NOT NULL,
      source_name text NOT NULL,
      source_url text NOT NULL,
      local_source_path text NOT NULL,
      server_path text NOT NULL UNIQUE,
      file_name text NOT NULL,
      media_type text NOT NULL,
      size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
      sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      storage_status text NOT NULL CHECK (storage_status IN ('planned','transferring','verified','failed')),
      database_relations text[] NOT NULL DEFAULT '{}',
      truth_status text NOT NULL,
      compatible_earths text[] NOT NULL DEFAULT '{}',
      copied_at timestamptz,
      verified_at timestamptz,
      error text,
      metadata jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await app.query(`
    CREATE INDEX IF NOT EXISTS raw_file_assets_earth_status_idx
    ON website_data.raw_file_assets (earth_layer,storage_status,dataset_group)
  `);
  await app.query(`
    COMMENT ON TABLE website_data.raw_file_assets IS
    '服务器原始文件资产索引；记录文件位置、来源、校验和、所属地球及对应结构化表，不保存文件二进制本体。'
  `);
  await app.query("COMMIT");
  const table = (
    await app.query(`
      SELECT to_regclass('website_data.raw_file_assets')::text AS relation,
             count(*)::int AS rows
      FROM website_data.raw_file_assets
    `)
  ).rows[0];
  const result = { preparedAt: new Date().toISOString(), server, table };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await app.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await app.end().catch(() => {});
  await admin.end().catch(() => {});
}
