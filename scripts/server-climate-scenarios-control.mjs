import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(path.dirname(repo), "outputs/20260920-climate-scenarios");
const manifestPath = path.join(output, "download-manifest.json");
const root = "D:/energy-platform-data/climate/gfdl-esm4/ssp245-370-585";
const codeRoot = "D:/energy-platform-runtime/climate-import-code";
const mode = process.argv[2] ?? "probe";
if (!["probe", "stage", "hotfix", "stop", "start", "status"].includes(mode)) throw new Error("Unknown mode");

const db = new Client({
  host: "218.197.118.49",
  port: 5432,
  database: "zyz",
  user: "postgres",
  password: process.env.MIGRATION_ADMIN_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 15_000,
  query_timeout: mode === "status" ? 120_000 : 180_000,
  keepAlive: true,
});
db.on("error", (error) => console.error(error.message));

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const program = (code) =>
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " +
  Buffer.from(code, "utf16le").toString("base64");

async function inspect(code) {
  const wrapper = `$ErrorActionPreference='Stop';try{$v=& {${code}};$s=$v|ConvertTo-Json -Depth 12 -Compress;[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)))}catch{[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{error=$_.Exception.Message}|ConvertTo-Json -Compress))))}`;
  if (program(wrapper).length > 8000) throw new Error("Remote inspection command is too long");
  await db.query("CREATE TEMP TABLE IF NOT EXISTS climate_scenario_control_output(value text); TRUNCATE climate_scenario_control_output");
  await db.query("COPY climate_scenario_control_output FROM PROGRAM " + literal(program(wrapper)));
  const rows = (await db.query("SELECT value FROM climate_scenario_control_output")).rows;
  if (rows.length !== 1) throw new Error("Unexpected management output");
  const result = JSON.parse(Buffer.from(rows[0].value, "base64").toString("utf8"));
  if (result.error) throw new Error(result.error);
  return result;
}

async function stageFile(target, bytes) {
  const code = `$p='${target}';[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null;if(Test-Path -LiteralPath $p){throw 'Stage target exists'};$b=[Convert]::FromBase64String([Console]::In.ReadLine());$s=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}`;
  await db.query("SELECT set_config('migration.climate_scenarios_payload',$1,false)", [bytes.toString("base64")]);
  await db.query("COPY (SELECT current_setting('migration.climate_scenarios_payload')) TO PROGRAM " + literal(program(code)));
  await db.query("SELECT set_config('migration.climate_scenarios_payload','',false)");
}

async function replaceFile(target, bytes) {
  const code = `$p='${target}';[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null;$b=[Convert]::FromBase64String([Console]::In.ReadLine());$s=[IO.File]::Open($p,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}`;
  await db.query("SELECT set_config('migration.climate_scenarios_payload',$1,false)", [bytes.toString("base64")]);
  await db.query("COPY (SELECT current_setting('migration.climate_scenarios_payload')) TO PROGRAM " + literal(program(code)));
  await db.query("SELECT set_config('migration.climate_scenarios_payload','',false)");
}

function validateManifest(manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const nc = files.filter((file) => file.kind === "climate_netcdf");
  const mat = files.filter((file) => file.kind === "vre_mat");
  if (files.length !== 63 || nc.length !== 60 || mat.length !== 3) {
    throw new Error(`Unexpected manifest counts: files=${files.length}, nc=${nc.length}, mat=${mat.length}`);
  }
  const names = new Set();
  for (const file of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(file.filename) || names.has(file.filename)) throw new Error(`Invalid or duplicate filename: ${file.filename}`);
    names.add(file.filename);
    if (!/^md5:[a-f0-9]{32}$/.test(file.checksum)) throw new Error(`Invalid checksum: ${file.filename}`);
    if (!/^https:\/\/zenodo\.org\/api\/records\/[0-9]+\/files\/.+\/content$/.test(file.download_url)) throw new Error(`Untrusted URL: ${file.filename}`);
    if (![17448039, 17461234, 17470247].includes(Number(file.record_id))) throw new Error(`Unexpected record id: ${file.filename}`);
  }
  return { files, nc, mat, totalBytes: files.reduce((sum, file) => sum + Number(file.bytes), 0) };
}

async function readRemoteJson(remotePath) {
  try {
    const result = (await db.query("SELECT pg_read_file($1,0,1000000,true) AS contents", [remotePath])).rows[0]?.contents;
    if (!result) return null;
    return JSON.parse(String(result).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

try {
  await db.connect();
  const identity = (await db.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,version()")).rows[0];
  if (identity.db !== "zyz" || identity.role !== "postgres" || identity.host !== "218.197.118.49" || !identity.version.includes("windows")) throw new Error("Target identity mismatch");
  await db.query("SET log_parameter_max_length=0; SET log_parameter_max_length_on_error=0");
  let result;
  if (mode === "probe") {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const checked = validateManifest(manifest);
    const first = checked.nc[0];
    result = await inspect(`@{computer=$env:COMPUTERNAME;drive=(Get-PSDrive D|Select-Object Name,Root,Free,Used);directoryExists=(Test-Path -LiteralPath '${root}')}`);
    result.manifest = { files: checked.files.length, netcdf: checked.nc.length, mat: checked.mat.length, totalBytes: checked.totalBytes };
    result.identity = identity;
  } else if (mode === "stage") {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const checked = validateManifest(manifest);
    const ready = await inspect(`@{free=(Get-PSDrive D).Free;rootExists=(Test-Path -LiteralPath '${root}')}`);
    if (Number(ready.free) < checked.totalBytes + 20_000_000_000) throw new Error("Insufficient free disk space for verified originals and import scratch");
    const tag = new Date().toISOString().replaceAll(/[^0-9TZ]/g, "");
    const codeDir = `${codeRoot}/scenarios-${tag}`;
    await stageFile(`${root}/download-manifest.json`, Buffer.from(JSON.stringify({ ...manifest, server_directory: root }, null, 2)));
    await stageFile(`${root}/server-climate-scenarios-worker.ps1`, await fs.readFile(path.join(repo, "scripts/server-climate-scenarios-worker.ps1")));
    const relative = [
      "scripts/import-selected-zenodo-climate-scenarios.py",
      "scripts/import-zenodo-climate-projection.py",
      "scripts/finalize-climate-import.py",
      "scripts/database-schema.sql",
    ];
    for (const file of relative) await stageFile(`${codeDir}/${file.replaceAll("\\", "/")}`, await fs.readFile(path.join(repo, file)));
    result = { status: "staged", root, manifest: `${root}/download-manifest.json`, worker: `${root}/server-climate-scenarios-worker.ps1`, codeDir, files: relative, stagedAt: new Date().toISOString(), manifestSummary: { files: checked.files.length, totalBytes: checked.totalBytes } };
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "server-scenarios-stage.json"), JSON.stringify(result, null, 2));
  } else if (mode === "hotfix") {
    await replaceFile(`${root}/server-climate-scenarios-worker.ps1`, await fs.readFile(path.join(repo, "scripts/server-climate-scenarios-worker.ps1")));
    result = { status: "hotfixed", worker: `${root}/server-climate-scenarios-worker.ps1`, updatedAt: new Date().toISOString() };
  } else if (mode === "stop") {
    const pipeline = await readRemoteJson(`${root}/pipeline-state.json`);
    const pid = Number(pipeline?.processId || 0);
    if (!pid) throw new Error("No pipeline process id is recorded");
    result = await inspect(`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($null -ne $p){Stop-Process -Id ${pid} -Force};@{stopped=$true;processId=${pid}}`);
  } else if (mode === "start") {
    const stage = JSON.parse(await fs.readFile(path.join(output, "server-scenarios-stage.json"), "utf8"));
    if (stage.status !== "staged" || !stage.codeDir.startsWith(`${codeRoot}/scenarios-`)) throw new Error("Scenario staging evidence is missing");
    if (!process.env.MIGRATION_APP_PASSWORD) throw new Error("MIGRATION_APP_PASSWORD is required for import");
    const ready = await inspect(`$p='${root}/server-climate-scenarios-worker.ps1';@{workerExists=(Test-Path -LiteralPath $p);manifestExists=(Test-Path -LiteralPath '${root}/download-manifest.json')}`);
    if (!ready.workerExists || !ready.manifestExists) throw new Error("Scenario launch prerequisites failed");
    const receipt = `${root}/launch-${new Date().toISOString().replaceAll(/[^0-9TZ]/g, "")}.json`;
    const launch = `$password=[Console]::In.ReadLine();if([string]::IsNullOrEmpty($password)){throw 'Missing credential'};$psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';$psi.Arguments=\"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${stage.worker} -ManifestPath ${stage.manifest} -CodeDir ${stage.codeDir}\";$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$p=[Diagnostics.Process]::Start($psi);$p.StandardInput.WriteLine($password);$p.StandardInput.Close();$password=$null;@{status='launched';processId=$p.Id;worker='${stage.worker}';manifest='${stage.manifest}';codeDir='${stage.codeDir}';directory='${root}';startedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath '${receipt}' -Encoding UTF8`;
    await db.query("SELECT set_config('migration.climate_scenarios_password',$1,false)", [process.env.MIGRATION_APP_PASSWORD]);
    await db.query("COPY (SELECT current_setting('migration.climate_scenarios_password')) TO PROGRAM " + literal(program(launch)));
    await db.query("SELECT set_config('migration.climate_scenarios_password','',false)");
    result = JSON.parse(((await db.query("SELECT pg_read_file($1) AS contents", [receipt])).rows[0].contents).replace(/^\uFEFF/, ""));
  } else {
    const pipeline = await readRemoteJson(`${root}/pipeline-state.json`);
    const importing = await readRemoteJson(`${root}/import-state.json`);
    const processInfo = null;
    const counts = (await db.query(`SELECT scenario,count(*)::int AS sources,count(*) FILTER (WHERE download_status='verified')::int AS verified,count(*) FILTER (WHERE import_status='imported')::int AS imported,coalesce(sum(imported_days),0)::bigint AS imported_days FROM website_data.climate_projection_sources WHERE zenodo_record_id = ANY($1::bigint[]) GROUP BY scenario ORDER BY scenario`, [[17448039, 17461234, 17470247]])).rows;
    const frames = (await db.query(`SELECT count(*)::bigint AS frames,count(DISTINCT source_id)::int AS sources,min(valid_date)::text AS first_date,max(valid_date)::text AS last_date FROM website_data.climate_projection_daily WHERE source_id IN (SELECT id FROM website_data.climate_projection_sources WHERE zenodo_record_id = ANY($1::bigint[]))`, [[17448039, 17461234, 17470247]])).rows[0];
    const names = (await db.query("SELECT name FROM pg_ls_dir($1) AS name WHERE name LIKE '%.part' OR name LIKE '%.err.log' OR name LIKE '%.nc' OR name LIKE '%.mat'", [root])).rows.map((row) => row.name);
    const files = [];
    for (const name of names) {
      const stat = (await db.query("SELECT size,modification FROM pg_stat_file($1)", [`${root}/${name}`])).rows[0];
      files.push({ name, ...stat });
    }
    result = { pipeline, importing, processInfo, counts, frames, files, databaseBytes: (await db.query("SELECT pg_database_size(current_database())::bigint AS bytes")).rows[0].bytes };
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `server-scenarios-${mode}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, detail: error.detail }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
