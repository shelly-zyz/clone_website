import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(path.dirname(repo),'outputs/20260904-climate-model-selection');
const root='D:/energy-platform-data/climate/gfdl-esm4/ssp126/zenodo-20501729';
const codeRoot='D:/energy-platform-runtime/climate-import-code';
const mode=process.argv[2]??'stage';
if(!['stage','canary','full','status'].includes(mode))throw new Error('Unknown mode');
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const program=code=>'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(code,'utf16le').toString('base64');
const db=new Client({host:'218.197.118.49',port:5432,database:'zyz',user:'postgres',password:process.env.MIGRATION_ADMIN_PASSWORD,ssl:false,connectionTimeoutMillis:15000,query_timeout:120000,keepAlive:true});
db.on('error',error=>console.error(error.message));
async function inspect(code){
 const wrapper=`$ErrorActionPreference='Stop';try{$v=& {${code}};$s=$v|ConvertTo-Json -Depth 10 -Compress;[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)))}catch{[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{error=$_.Exception.Message}|ConvertTo-Json -Compress))))}`;
 await db.query('CREATE TEMP TABLE IF NOT EXISTS climate_import_output(value text);TRUNCATE climate_import_output');
 await db.query('COPY climate_import_output FROM PROGRAM '+literal(program(wrapper)));
 const rows=(await db.query('SELECT value FROM climate_import_output')).rows;if(rows.length!==1)throw new Error('Unexpected server output');
 const result=JSON.parse(Buffer.from(rows[0].value,'base64').toString('utf8'));if(result.error)throw new Error(result.error);return result;
}
async function stageFile(target,bytes){
 const code=`$p='${target}';[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null;if(Test-Path -LiteralPath $p){throw 'Stage target exists'};$b=[Convert]::FromBase64String([Console]::In.ReadLine());$s=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}`;
 await db.query("SELECT set_config('migration.climate_code',$1,false)",[bytes.toString('base64')]);await db.query("COPY (SELECT current_setting('migration.climate_code')) TO PROGRAM "+literal(program(code)));await db.query("SELECT set_config('migration.climate_code','',false)");
}
try{
 await db.connect();const identity=(await db.query('SELECT current_database() db,current_user role,host(inet_server_addr()) host,version()')).rows[0];
 if(identity.db!=='zyz'||identity.role!=='postgres'||identity.host!=='218.197.118.49'||!identity.version.includes('windows'))throw new Error('Target identity mismatch');
 await db.query('SET log_parameter_max_length=0;SET log_parameter_max_length_on_error=0');let result;
 if(mode==='stage'){
  const runtime=JSON.parse(await fs.readFile(path.join(output,'server-runtime-setup.json'),'utf8'));if(runtime.status!=='ready')throw new Error('Runtime not verified');
  const tag=new Date().toISOString().replaceAll(/[^0-9TZ]/g,'');const codeDir=`${codeRoot}/code-${tag}`;
  const relative=['scripts/import-zenodo-climate-projection.py','scripts/import-all-pending-zenodo-climate.py','scripts/finalize-climate-import.py','scripts/database-schema.sql','scripts/server-climate-import-worker.ps1'];
  for(const file of relative){await stageFile(`${codeDir}/${file.replaceAll('\\','/')}`,await fs.readFile(path.join(repo,file)));}
  result={status:'staged',codeDir,files:relative,runtime:runtime.python,stagedAt:new Date().toISOString()};
 }else if(mode==='status'){
 const raw=(await db.query('SELECT pg_read_file($1,0,1000000,true) contents',[`${root}/import-state.json`])).rows[0].contents;
  const state=raw?JSON.parse(raw.replace(/^\uFEFF/,'')):null;
  const counts=(await db.query(`SELECT count(*)::int frames,count(DISTINCT source_id)::int sources,min(valid_date) first_date,max(valid_date) last_date,count(*) FILTER(WHERE octet_length(frame_data)=0 OR frame_sha256 IS NULL)::int invalid_frames FROM website_data.climate_projection_daily`)).rows[0];
  const source=(await db.query(`SELECT count(*) FILTER(WHERE import_status='imported')::int imported,count(*) FILTER(WHERE import_status='partial')::int partial,count(*) FILTER(WHERE import_status='pending')::int pending,count(*) FILTER(WHERE import_status='failed')::int failed FROM website_data.climate_projection_sources WHERE zenodo_record_id=20501729`)).rows[0];
  let runtime=null;
  if(state?.log){
   const escapedLog=state.log.replaceAll("'","''");
   const escapedErr=(state.log+'.err').replaceAll("'","''");
   runtime=await inspect(`$pidValue=${Number(state.processId)||0};$process=Get-Process -Id $pidValue -ErrorAction SilentlyContinue;@{processAlive=($null -ne $process);logTail=@(if(Test-Path -LiteralPath '${escapedLog}'){Get-Content -LiteralPath '${escapedLog}' -Tail 30});errorTail=@(if(Test-Path -LiteralPath '${escapedErr}'){Get-Content -LiteralPath '${escapedErr}' -Tail 30})}`);
  }
  result={state,runtime,counts,sources:source,databaseBytes:(await db.query('SELECT pg_database_size(current_database()) bytes')).rows[0].bytes};
 }else{
  const staged=JSON.parse(await fs.readFile(path.join(output,'server-import-stage.json'),'utf8'));if(staged.status!=='staged'||!staged.codeDir.startsWith(`${codeRoot}/code-`))throw new Error('Staged code evidence missing');
  const ready=await inspect(`$l='${root}/.import.lock';if(Test-Path -LiteralPath $l){$s=[IO.File]::Open($l,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$s.Dispose()};@{lockAvailable=$true;runtimeExists=(Test-Path -LiteralPath 'D:/energy-platform-runtime/climate-import-python313/Scripts/python.exe');codeExists=(Test-Path -LiteralPath '${staged.codeDir}/scripts/server-climate-import-worker.ps1')}`);
  if(!ready.lockAvailable||!ready.runtimeExists||!ready.codeExists)throw new Error('Import prerequisites failed');
  await db.query("SELECT set_config('migration.climate_import_password',$1,false)",[process.env.MIGRATION_APP_PASSWORD]);
  const receipt=`${root}/import-launch-${mode}-${new Date().toISOString().replaceAll(/[^0-9TZ]/g,'')}.json`;const worker=`${staged.codeDir}/scripts/server-climate-import-worker.ps1`;
  const launch=`$password=[Console]::In.ReadLine();if([string]::IsNullOrEmpty($password)){throw 'Missing credential'};$psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';$psi.Arguments=\"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${worker} -Mode ${mode} -CodeDir ${staged.codeDir}\";$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$p=[Diagnostics.Process]::Start($psi);$p.StandardInput.WriteLine($password);$p.StandardInput.Close();$password=$null;@{status='launched';mode='${mode}';processId=$p.Id;codeDir='${staged.codeDir}';launchedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath '${receipt}' -Encoding UTF8`;
  await db.query("COPY (SELECT current_setting('migration.climate_import_password')) TO PROGRAM "+literal(program(launch)));await db.query("SELECT set_config('migration.climate_import_password','',false)");
  result=JSON.parse(((await db.query('SELECT pg_read_file($1) contents',[receipt])).rows[0].contents).replace(/^\uFEFF/,''));
 }
 await fs.writeFile(path.join(output,`server-import-${mode}.json`),JSON.stringify({checkedAt:new Date().toISOString(),...result},null,2));console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({error:error.message.startsWith('program ')?'Server import command failed':error.message,code:error.code,detail:error.detail}));process.exitCode=1;}finally{await db.end().catch(()=>{});}
