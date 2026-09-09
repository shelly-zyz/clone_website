import { promises as fs,createReadStream,createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from 'pg';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(path.dirname(repo),'outputs/20260904-pg-migration');
const reportPath=path.join(output,'final-verification.json');
const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
if(!process.env.PGPASSWORD||!report.checksPassed)throw new Error('Secure launcher and passed data verification required');
const stamp=new Date().toISOString().replaceAll(/[^0-9TZ]/g,'');
const partial=path.join(output,`zyz-restored-${stamp}.incomplete.dump`);
const complete=path.join(output,`zyz-restored-${stamp}.dump`);
const log=createWriteStream(path.join(output,`backup-${stamp}.log`),{flags:'wx'});
const safe=text=>String(text).replaceAll(process.env.PGPASSWORD,'[REDACTED]');
const client=new Client({connectionString:process.env.DATABASE_URL,ssl:false,connectionTimeoutMillis:15000,query_timeout:30000});
client.on('error',error=>console.error(safe(error.message)));
async function command(name,args,monitor=false){
  await new Promise((resolve,reject)=>{
    const child=spawn(path.join('C:/Program Files/PostgreSQL/17/bin',name),args,{env:process.env,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let tail='',lastSize=0,lastProgress=Date.now(),stalled=false,ticking=false;
    child.stderr.on('data',data=>{const text=safe(data);tail=(tail+text).slice(-2500);log.write(text);if(!text.includes('reading ')&&!text.includes('saving '))process.stdout.write(text);});
    const timer=monitor?setInterval(async()=>{
      if(ticking)return;ticking=true;
      try{
        const size=(await fs.stat(partial).catch(()=>({size:0}))).size;
        if(size!==lastSize){lastSize=size;lastProgress=Date.now();}
        console.log(`Backup progress: ${(size/1048576).toFixed(1)} MiB`);
        if(Date.now()-lastProgress>180000){stalled=true;child.kill();}
      }finally{ticking=false;}
    },30000):null;
    child.on('error',error=>{if(timer)clearInterval(timer);reject(error);});
    child.on('close',code=>{if(timer)clearInterval(timer);if(code===0)resolve();else reject(new Error(stalled?'Backup stalled for 180 seconds; incomplete artifact retained':`${name} failed (${code}): ${tail}`));});
  });
}
try {
  await client.connect();
  const identity=(await client.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,version(),(SELECT count(*)::int FROM website_data.carbon_emission_frames) AS carbon_frames")).rows[0];
  if(identity.db!=='zyz'||identity.role!=='zyz'||identity.host!=='218.197.118.49'||!identity.version.includes('windows')||identity.carbon_frames!==2739)throw new Error('Target identity or previously verified frame count differs');
  console.log(JSON.stringify({identity}));
  await client.end();
  await command('pg_dump.exe',['--dbname=host=218.197.118.49 port=5432 dbname=zyz user=zyz sslmode=disable connect_timeout=15 keepalives=1 keepalives_idle=10 keepalives_interval=10 keepalives_count=5',
    '--format=custom','--compress=1','--verbose','--lock-wait-timeout=15s','--no-owner','--no-privileges','--file',partial],true);
  console.log('Checking backup directory and all archive blocks...');
  await command('pg_restore.exe',['--list',partial]);
  await command('pg_restore.exe',['--file=NUL',partial]);
  const hash=createHash('sha256');for await(const chunk of createReadStream(partial))hash.update(chunk);
  await fs.rename(partial,complete);
  report.backup={status:'complete',file:complete,bytes:(await fs.stat(complete)).size,sha256:hash.digest('hex'),archiveListVerified:true,allArchiveBlocksRead:true,isolatedRestoreTest:false,completedAt:new Date().toISOString()};
  await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({backup:report.backup},null,2));
}catch(error){
  report.backup={status:'failed',file:partial,error:safe(error.message),checkedAt:new Date().toISOString(),archiveListVerified:false,isolatedRestoreTest:false};
  await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  console.error(safe(error.message));process.exitCode=1;
}finally{await client.end().catch(()=>{});await new Promise(resolve=>log.end(resolve));}
