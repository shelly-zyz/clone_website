import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(path.dirname(repo), "outputs/20260920-climate-scenarios");
const manifestPath = path.join(output, "download-manifest.json");
const root = "D:/energy-platform-data/climate/gfdl-esm4/ssp245-370-585";
const codeRoot = "D:/energy-platform-runtime/climate-import-code";
const runtime = "C:/ProgramData/anaconda3/python.exe";
const climateRuntime = "D:/energy-platform-runtime/climate-import-python313/Scripts/python.exe";
const mode = process.argv[2] ?? "probe";
if (!["probe", "stage", "install", "start", "status"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);

const db = new Client({
  host: "218.197.118.49",
  port: 5432,
  database: "zyz",
  user: "postgres",
  password: process.env.MIGRATION_ADMIN_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 15_000,
  query_timeout: mode === "status" ? 120_000 : 180_000,
});

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const program = (code) =>
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " +
  Buffer.from(code, "utf16le").toString("base64");

async function inspect(code) {
  const wrapper = `$ErrorActionPreference='Stop';try{$v=& {${code}};$s=$v|ConvertTo-Json -Depth 12 -Compress;[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)))}catch{[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{error=$_.Exception.Message}|ConvertTo-Json -Compress))))}`;
  await db.query("CREATE TEMP TABLE IF NOT EXISTS vre_control_output(value text); TRUNCATE vre_control_output");
  await db.query("COPY vre_control_output FROM PROGRAM " + literal(program(wrapper)));
  const rows = (await db.query("SELECT value FROM vre_control_output")).rows;
  if (rows.length !== 1) throw new Error("Unexpected remote management output");
  const result = JSON.parse(Buffer.from(rows[0].value, "base64").toString("utf8"));
  if (result.error) throw new Error(result.error);
  return result;
}

async function stageFile(target, bytes) {
  const code = `$p='${target}';[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null;if(Test-Path -LiteralPath $p){throw 'Stage target exists'};$b=[Convert]::FromBase64String([Console]::In.ReadLine());$s=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}`;
  await db.query("SELECT set_config('migration.vre_payload',$1,false)", [bytes.toString("base64")]);
  await db.query("COPY (SELECT current_setting('migration.vre_payload')) TO PROGRAM " + literal(program(code)));
  await db.query("SELECT set_config('migration.vre_payload','',false)");
}

function validateManifest(manifest) {
  const mat = (manifest.files ?? []).filter((item) => item.kind === "vre_mat");
  if (mat.length !== 3) throw new Error(`Expected 3 VRE MAT files, got ${mat.length}`);
  for (const item of mat) {
    if (!/^[A-Za-z0-9._-]+\.mat$/.test(item.filename)) throw new Error(`Invalid MAT filename: ${item.filename}`);
    if (!/^md5:[a-f0-9]{32}$/.test(item.checksum)) throw new Error(`Invalid MAT checksum: ${item.filename}`);
    if (!/^(gfdl-esm4)_(ssp\d+)$/.test(`${item.gcm}_${item.scenario}`)) throw new Error(`Unexpected MAT identity: ${item.filename}`);
  }
  return mat;
}

async function readRemoteJson(remotePath) {
  try {
    const result = (await db.query("SELECT pg_read_file($1,0,2000000,true) AS contents", [remotePath])).rows[0]?.contents;
    return result ? JSON.parse(String(result).replace(/^\uFEFF/, "")) : null;
  } catch {
    return null;
  }
}

async function readRemoteText(remotePath, limit = 200000) {
  try {
    const result = (await db.query("SELECT pg_read_file($1,0,$2,true) AS contents", [remotePath, limit])).rows[0]?.contents;
    return result == null ? null : String(result);
  } catch {
    return null;
  }
}

try {
  await db.connect();
  const identity = (await db.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,version()" )).rows[0];
  if (identity.db !== "zyz" || identity.role !== "postgres" || identity.host !== "218.197.118.49" || !identity.version.includes("windows")) throw new Error("Target identity mismatch");
  let result;
  if (mode === "probe") {
    result = await inspect(`$p='${runtime}';$items=@('VRE_gfdl-esm4_ssp245_2021_2060.mat','VRE_gfdl-esm4_ssp370_2021_2060.mat','VRE_gfdl-esm4_ssp585_2021_2060.mat');$pythonCommands=@(Get-Command python.exe -All -ErrorAction SilentlyContinue|ForEach-Object {$_.Source});$candidate=@(Get-ChildItem -Path 'C:/Users/*/anaconda*/python.exe','C:/ProgramData/Anaconda*/python.exe','D:/*/python.exe' -File -ErrorAction SilentlyContinue|ForEach-Object {$_.FullName});$paths=@('C:/ProgramData/anaconda3/Lib/site-packages/h5py','C:/ProgramData/anaconda3/Lib/site-packages/numpy','C:/ProgramData/anaconda3/Lib/site-packages/psycopg2','C:/ProgramData/anaconda3/Lib/site-packages/psycopg','C:/ProgramData/anaconda3/Lib/site-packages/asyncpg','D:/energy-platform-runtime/climate-import-python313/Lib/site-packages/psycopg2');$pathChecks=@($paths|ForEach-Object {@{path=$_;exists=(Test-Path -LiteralPath $_)}});@{runtimeExists=(Test-Path -LiteralPath $p);files=@($items|ForEach-Object {@{name=$_;exists=(Test-Path -LiteralPath (Join-Path '${root}' $_));bytes=if(Test-Path -LiteralPath (Join-Path '${root}' $_)){(Get-Item -LiteralPath (Join-Path '${root}' $_)).Length}else{0}}});pythonCommands=$pythonCommands;candidates=$candidate;pathChecks=$pathChecks}`);
  } else if (mode === "stage") {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const mat = validateManifest(manifest);
    const tag = new Date().toISOString().replaceAll(/[^0-9TZ]/g, "");
    const stageDir = `${codeRoot}/vre-mat-${tag}`;
    const files = [
      ["scripts/import-vre-mat-to-postgres.py", "scripts/import-vre-mat-to-postgres.py"],
      ["scripts/build-climate-vre-data.py", "scripts/build-climate-vre-data.py"],
      ["public/data/natural-earth/ne_50m_admin_1_states_provinces.geojson", "public/data/natural-earth/ne_50m_admin_1_states_provinces.geojson"],
      ["src/lib/china-map-data.generated.json", "src/lib/china-map-data.generated.json"],
    ];
    for (const [local, remote] of files) await stageFile(`${stageDir}/${remote.replaceAll("\\", "/")}`, await fs.readFile(path.join(repo, local)));
    result = { status: "staged", root, stageDir, runtime, statePath: `${root}/vre-import-state.json`, files: files.map(([local, remote]) => ({ local, remote: `${stageDir}/${remote}` })), manifest: `${root}/download-manifest.json`, mat: mat.map((item) => ({ filename: item.filename, bytes: item.bytes, md5: item.checksum })) };
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "server-vre-stage.json"), JSON.stringify(result, null, 2));
  } else if (mode === "install") {
    const log = `${root}/vre-anaconda-pip.log`;
    const errorLog = `${root}/vre-anaconda-pip.err.log`;
    result = await inspect(`$p='${runtime}';$out='${log}';$err='${errorLog}';$proc=Start-Process -FilePath $p -ArgumentList @('-m','pip','install','--no-input','--disable-pip-version-check','psycopg2-binary') -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err;@{status='started';processId=$proc.Id;log=$out;errorLog=$err;startedAt=[DateTime]::UtcNow.ToString('o')}`);
  } else if (mode === "start") {
    const stage = JSON.parse(await fs.readFile(path.join(output, "server-vre-stage.json"), "utf8"));
    if (stage.status !== "staged" || !stage.stageDir.startsWith(`${codeRoot}/vre-mat-`)) throw new Error("VRE staging evidence is missing");
    if (!process.env.MIGRATION_APP_PASSWORD) throw new Error("MIGRATION_APP_PASSWORD is required for start");
    const ready = await inspect(`@{runtime=(Test-Path -LiteralPath '${runtime}');manifest=(Test-Path -LiteralPath '${stage.manifest}');root=(Test-Path -LiteralPath '${root}')}`);
    if (!ready.runtime || !ready.manifest || !ready.root) throw new Error("VRE launch prerequisites failed");
    const script = `${stage.stageDir}/scripts/import-vre-mat-to-postgres.py`;
    const statePath = `${root}/vre-import-state.json`;
    const receipt = `${root}/vre-import-launch-${new Date().toISOString().replaceAll(/[^0-9TZ]/g, "")}.json`;
    const launch = `$password=[Console]::In.ReadLine();if([string]::IsNullOrEmpty($password)){throw 'Missing credential'};$env:DATABASE_URL='postgresql://zyz:'+([Uri]::EscapeDataString($password))+'@127.0.0.1:5432/zyz';$env:PYTHONUNBUFFERED='1';$outLog='${root}/vre-import-launch.log';$errLog='${root}/vre-import-launch.err.log';$argList=@('${script}','--root','${root}','--code-root','${stage.stageDir}','--state-path','${statePath}');$p=Start-Process -FilePath '${runtime}' -ArgumentList $argList -WorkingDirectory '${stage.stageDir}' -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog;$env:DATABASE_URL=$null;$env:PYTHONUNBUFFERED=$null;@{status='launched';processId=$p.Id;script='${script}';statePath='${statePath}';log=$outLog;errorLog=$errLog;startedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath '${receipt}' -Encoding UTF8`;
    await db.query("SELECT set_config('migration.vre_password',$1,false)", [process.env.MIGRATION_APP_PASSWORD]);
    await db.query("COPY (SELECT current_setting('migration.vre_password')) TO PROGRAM " + literal(program(launch)));
    await db.query("SELECT set_config('migration.vre_password','',false)");
    result = JSON.parse(((await db.query("SELECT pg_read_file($1) AS contents", [receipt])).rows[0].contents).replace(/^\uFEFF/, ""));
  } else {
    const state = await readRemoteJson(`${root}/vre-import-state.json`);
    const rows = (await db.query(`
      SELECT gcm,scenario,import_status,imported_rows,file_name,expected_size_bytes
      FROM website_data.climate_vre_sources
      WHERE gcm='gfdl-esm4' AND scenario IN ('ssp245','ssp370','ssp585')
      ORDER BY scenario
    `)).rows;
    const counts = (await db.query(`
      SELECT gcm,scenario,count(*)::int AS rows,count(DISTINCT region_id)::int AS regions,
             min(year)::int AS first_year,max(year)::int AS last_year
      FROM website_data.climate_vre_hourly
      WHERE gcm='gfdl-esm4' AND scenario IN ('ssp245','ssp370','ssp585')
      GROUP BY gcm,scenario ORDER BY scenario
    `)).rows;
    const process = await inspect(`@{processes=@(Get-CimInstance Win32_Process|Where-Object {$_.CommandLine -like '*import-vre-mat-to-postgres*'}|ForEach-Object {@{id=$_.ProcessId;command=$_.CommandLine}})}`);
    result = {
      state,
      sources: rows,
      counts,
      process: process.processes,
      launchLog: await readRemoteText(`${root}/vre-import-launch.log`),
      launchErrorLog: await readRemoteText(`${root}/vre-import-launch.err.log`),
      installLog: await readRemoteText(`${root}/vre-anaconda-pip.log`),
      installErrorLog: await readRemoteText(`${root}/vre-anaconda-pip.err.log`),
    };
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `server-vre-${mode}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, detail: error.detail }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
