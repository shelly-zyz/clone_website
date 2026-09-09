import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(path.dirname(repo), 'outputs/20260904-climate-model-selection');
const root = 'D:/energy-platform-data/climate/gfdl-esm4/ssp126/zenodo-20501729';
const mode = process.argv[2] ?? 'probe';
if (!['probe', 'start', 'status', 'import-probe', 'runtime-probe', 'runtime-setup'].includes(mode)) throw new Error('Unknown mode');
const db = new Client({ host: '218.197.118.49', port: 5432, database: 'zyz', user: 'postgres',
  password: process.env.MIGRATION_ADMIN_PASSWORD, ssl: false, connectionTimeoutMillis: 15000,
  query_timeout: mode === 'runtime-setup' ? 900000 : 120000, keepAlive: true });
db.on('error', error => console.error(error.message));
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const program = code => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(code, 'utf16le').toString('base64');
async function inspect(code) {
  const wrapper = `$ErrorActionPreference='Stop';try {$v=& {${code}};$s=$v|ConvertTo-Json -Depth 12 -Compress;[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)))}catch{[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{error=$_.Exception.Message}|ConvertTo-Json -Compress))))}`;
  if (program(wrapper).length > 8000) throw new Error('Inspection command too long');
  await db.query('CREATE TEMP TABLE IF NOT EXISTS climate_control_output(value text); TRUNCATE climate_control_output');
  await db.query('COPY climate_control_output FROM PROGRAM ' + literal(program(wrapper)));
  const rows = (await db.query('SELECT value FROM climate_control_output')).rows;
  if (rows.length !== 1) throw new Error('Unexpected management output');
  const result = JSON.parse(Buffer.from(rows[0].value, 'base64').toString('utf8'));
  if (result.error) throw new Error(result.error);
  return result;
}
async function stage(target, bytes) {
  const code = `$ErrorActionPreference='Stop';$p='${target}';$d=[IO.Path]::GetDirectoryName($p);[IO.Directory]::CreateDirectory($d)|Out-Null;$b=[Convert]::FromBase64String([Console]::In.ReadLine());$f=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);try{$f.Write($b,0,$b.Length)}finally{$f.Dispose()}`;
  await db.query("SELECT set_config('migration.climate_payload',$1,false)", [bytes.toString('base64')]);
  await db.query("COPY (SELECT current_setting('migration.climate_payload')) TO PROGRAM " + literal(program(code)));
  await db.query("SELECT set_config('migration.climate_payload','',false)");
}
try {
  await db.connect();
  const identity = (await db.query('SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,version()')).rows[0];
  if (identity.db !== 'zyz' || identity.role !== 'postgres' || identity.host !== '218.197.118.49' || !identity.version.includes('windows')) throw new Error('Target identity mismatch');
  await db.query('SET log_parameter_max_length=0; SET log_parameter_max_length_on_error=0');
  let result;
  if (mode === 'probe') {
    result = await inspect(`$c='C:/Windows/System32/curl.exe';$h=& $c --silent --show-error --stderr - --head --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 30 'https://zenodo.org/api/records/20501729/files/gfdl-esm4_ssp126_rsds_2021_2030.nc/content';$ec=$LASTEXITCODE;@{computer=$env:COMPUTERNAME;drive=(Get-PSDrive D|Select-Object Name,Root,Free,Used);curlExists=(Test-Path -LiteralPath $c);headExit=$ec;headers=@($h);directoryExists=(Test-Path -LiteralPath '${root}');existingFiles=@(if(Test-Path -LiteralPath '${root}'){Get-ChildItem -LiteralPath '${root}' -File|Select-Object Name,Length})}`);
    result.identity = identity;
  } else if (mode === 'import-probe') {
    result = await inspect(`
      $commands=@('python.exe','python3.exe','py.exe','uv.exe')
      $found=@()
      foreach($command in $commands){$x=Get-Command $command -ErrorAction SilentlyContinue;if($null -ne $x){$found+=@{name=$command;source=$x.Source}}}
      $known=@('C:/Python314/python.exe','C:/Python313/python.exe','C:/Python312/python.exe','C:/Python311/python.exe','C:/Program Files/Python314/python.exe','C:/Program Files/Python313/python.exe','C:/Program Files/Python312/python.exe','C:/Program Files/Python311/python.exe','D:/Python314/python.exe','D:/Python313/python.exe','D:/Python312/python.exe','D:/Python311/python.exe')
      foreach($candidate in $known){if(Test-Path -LiteralPath $candidate){$found+=@{name='known-path';source=$candidate}}}
      @{commands=@($found|Sort-Object source -Unique);psVersion=$PSVersionTable.PSVersion.ToString();serverDirectory='${root}'}
    `);
  } else if (mode === 'runtime-probe') {
    result = await inspect(`
      $python='D:/Scripts/python.exe'
      if(!(Test-Path -LiteralPath $python)){throw 'Expected Python path is absent'}
      $version=@(& $python --version 2>&1);$versionExit=$LASTEXITCODE
      $code='import json,sys; result={"python":sys.version};\ntry:\n import numpy,netCDF4,psycopg2\n result.update({"numpy":numpy.__version__,"netCDF4":netCDF4.__version__,"psycopg2":psycopg2.__version__})\nexcept Exception as e:\n result["dependencyError"]=repr(e)\nprint(json.dumps(result))'
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code))
      $details=@(& $python '-c' ("import base64;exec(base64.b64decode('"+$encoded+"'))") 2>&1);$detailsExit=$LASTEXITCODE
      @{path=$python;version=$version;versionExit=$versionExit;details=$details;detailsExit=$detailsExit}
    `);
  } else if (mode === 'runtime-setup') {
    result = await inspect(`
      $systemPython='D:/Scripts/python.exe';$runtime='D:/energy-platform-runtime/climate-import-python313';$runtimePython=$runtime+'/Scripts/python.exe';$log='${root}/runtime-setup.log'
      $parent=[IO.DirectoryInfo]'D:/energy-platform-runtime';while($null -ne $parent){if($parent.Exists -and (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'Reparse point in runtime path'};$parent=$parent.Parent}
      if(!(Test-Path -LiteralPath $systemPython)){throw 'System Python path is absent'}
      if(!(Test-Path -LiteralPath $runtimePython)){& $systemPython -m venv $runtime *>&1|Set-Content -LiteralPath $log -Encoding UTF8;if($LASTEXITCODE -ne 0){throw ('venv setup failed: '+(@(Get-Content -LiteralPath $log -Tail 10)-join ' '))}}
      & $runtimePython -m pip install --disable-pip-version-check --only-binary=:all: 'numpy>=2.1,<3' 'netCDF4>=1.7,<2' 'psycopg2-binary==2.9.12' 'python-dotenv>=1.0,<2' *>&1|Set-Content -LiteralPath $log -Encoding UTF8
      if($LASTEXITCODE -ne 0){throw ('dependency setup failed: '+(@(Get-Content -LiteralPath $log -Tail 15)-join ' '))}
      $code='import json,sys,numpy,netCDF4,psycopg2,dotenv;print(json.dumps({"python":sys.version,"numpy":numpy.__version__,"netCDF4":netCDF4.__version__,"psycopg2":psycopg2.__version__}))'
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code));$details=@(& $runtimePython '-c' ("import base64;exec(base64.b64decode('"+$encoded+"'))") 2>&1)
      if($LASTEXITCODE -ne 0){throw ('runtime validation failed: '+($details-join ' '))}
      @{status='ready';runtime=$runtime;python=$runtimePython;details=$details;log=$log}
    `);
  } else if (mode === 'start') {
    const probe = JSON.parse(await fs.readFile(path.join(out, 'server-probe.json'), 'utf8'));
    if (probe.headExit !== 0 || !probe.headers.some(line => /^HTTP\/\S+ 200\b/.test(line)) || Date.now() - Date.parse(probe.checkedAt) > 3600000) throw new Error('Need successful recent server network preflight');
    const manifest = JSON.parse((await fs.readFile(path.join(out, 'download-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const nc = manifest.files.filter(f => f.filename.endsWith('.nc'));
    if (nc.length !== 20 || nc.reduce((n, f) => n + f.bytes, 0) !== 21524120425) throw new Error('Unexpected manifest');
    for (const f of nc) {
      if (!/^gfdl-esm4_ssp126_(huss|rsds|tas|sfcwind|ps)_(2021_2030|2031_2040|2041_2050|2051_2060)\.nc$/.test(f.filename) || !/^md5:[a-f0-9]{32}$/.test(f.checksum) || f.download_url !== `https://zenodo.org/api/records/20501729/files/${f.filename}/content`) throw new Error('Untrusted file entry');
    }
    const ready = await inspect(`$p=[IO.DirectoryInfo]'${root}';while($null -ne $p){if($p.Exists -and (($p.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'Reparse point in target path'};$p=$p.Parent};$l='${root}/.download.lock';if(Test-Path -LiteralPath $l){$s=[IO.File]::Open($l,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$s.Dispose()};@{free=(Get-PSDrive D).Free;exclusiveLockAvailable=$true}`);
    if (ready.free < 35e9) throw new Error('Need at least 35 GB available');
    if (!ready.exclusiveLockAvailable) throw new Error('A climate download worker is already active');
    const tag = new Date().toISOString().replaceAll(/[^0-9TZ]/g, '');
    const worker = `${root}/server-climate-worker-${tag}.ps1`;
    const manifestPath = `${root}/download-manifest-${tag}.json`;
    await stage(manifestPath, Buffer.from(JSON.stringify({ ...manifest, files: nc, server_directory: root }, null, 2)));
    const workerBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await fs.readFile(path.join(repo, 'scripts/server-climate-worker.ps1'))]);
    await stage(worker, workerBytes);
    // COPY TO waits for the launcher, not an inherited output pipe held by the
    // long-running download process. Read its durable receipt separately.
    const receipt = `${root}/launch-${tag}.json`;
    const launch = `$ErrorActionPreference='Stop';if(Test-Path -LiteralPath '${receipt}'){throw 'Launch receipt exists'};$x=Start-Process -FilePath 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${worker}','-ManifestPath','${manifestPath}') -RedirectStandardOutput '${root}/worker-${tag}.out.log' -RedirectStandardError '${root}/worker-${tag}.err.log';@{status='launched';processId=$x.Id;worker='${worker}';manifest='${manifestPath}';directory='${root}';startedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath '${receipt}' -Encoding UTF8`;
    await db.query("COPY (SELECT '') TO PROGRAM " + literal(program(launch)));
    const receiptText = (await db.query('SELECT pg_read_file($1) AS contents', [receipt])).rows[0].contents;
    result = JSON.parse(receiptText.replace(/^\uFEFF/, ''));
  } else {
    const raw = (await db.query('SELECT pg_read_file($1,0,1000000,true) AS contents', [`${root}/download-state.json`])).rows[0].contents;
    const names = (await db.query("SELECT name FROM pg_ls_dir($1) AS name WHERE name LIKE 'gfdl-esm4_ssp126_%.nc%' OR name LIKE '%.err.log'", [root])).rows.map(r => r.name);
    result = { state: raw ? JSON.parse(raw.replace(/^\uFEFF/, '')) : null, files: [], errors: [] };
    for (const name of names) {
      if (name.includes('/') || name.includes('\\')) throw new Error('Invalid directory entry');
      const stat = (await db.query('SELECT size,modification FROM pg_stat_file($1)', [`${root}/${name}`])).rows[0];
      result.files.push({ name, ...stat });
      if (name.endsWith('.err.log') && Number(stat.size) > 0) {
        const log = (await db.query('SELECT pg_read_binary_file($1,$2,4096,true) AS contents', [`${root}/${name}`, Math.max(0, Number(stat.size) - 4096)])).rows[0].contents;
        let tail;
        try { tail = new TextDecoder('utf-8', { fatal: true }).decode(log); }
        catch { tail = new TextDecoder('gb18030').decode(log); }
        result.errors.push({ name, modification: stat.modification, tail });
      }
    }
    const started = Date.parse(result.state?.startedAt ?? '');
    result.historicalErrors = result.errors.filter(e => Date.parse(e.modification) < started);
    result.errors = result.errors.filter(e => !(Date.parse(e.modification) < started));
    result.stateStale = result.state?.status === 'running' && Date.now() - Date.parse(result.state.updatedAt) > 120000;
  }
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, `server-${mode}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
  const display = mode === 'status' ? { checkedAt: new Date().toISOString(), status: result.state?.status, stateStale: result.stateStale, completedFiles: result.state?.completed?.length, current: result.state?.current, updatedAt: result.state?.updatedAt, failed: result.state?.failed, files: result.files.filter(f => f.name.includes('.nc')), errors: result.errors, historicalErrorCount: result.historicalErrors.length } : result;
  console.log(JSON.stringify(display, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message.startsWith('program ') ? 'Server management command failed' : error.message, code: error.code, detail: error.detail }));
  process.exitCode = 1;
} finally { await db.end().catch(() => {}); }
