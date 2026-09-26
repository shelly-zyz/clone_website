import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(path.dirname(repo),'outputs/20260904-pg-migration');
const reportPath=path.join(output,'final-verification.json');
const report=JSON.parse((await fs.readFile(reportPath,'utf8')).replace(/^\uFEFF/,''));
const backup=report.backup;
if(backup.status!=='complete'||backup.location!=='target-server'||!/^D:\\pgbackups\\zyz-server-[0-9TZ]+\.dump$/.test(backup.file))throw new Error('Verified server backup required');
let previous;
try{previous=JSON.parse(await fs.readFile(path.join(output,'server-restore-verification.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const resume=previous?.backupFile===backup.file&&previous.createdOid&&!previous.temporaryDatabaseDropped;
const name=resume?previous.database:'zyz_verify_'+new Date().toISOString().replaceAll(/[^0-9]/g,'');
if(!/^zyz_verify_\d+$/.test(name))throw new Error('Invalid audit database name');
const result={database:name,backupFile:backup.file,passed:false,temporaryDatabaseDropped:false,tableCounts:{}};
const options={host:'218.197.118.49',port:5432,ssl:false,connectionTimeoutMillis:15000,query_timeout:7200000,keepAlive:true,keepAliveInitialDelayMillis:10000};
const admin=new Client({...options,database:'zyz',user:'postgres',password:process.env.MIGRATION_ADMIN_PASSWORD});
const audit=new Client({...options,database:name,user:'zyz',password:process.env.MIGRATION_APP_PASSWORD});
admin.on('error',error=>console.error(error.message));audit.on('error',error=>console.error(error.message));
try {
 await admin.connect();
 const identity=(await admin.query('SELECT current_database() AS db,host(inet_server_addr()) AS host,version()')).rows[0];
 if(identity.db!=='zyz'||identity.host!=='218.197.118.49'||!identity.version.includes('windows'))throw new Error('Wrong management target');
 const existing=(await admin.query('SELECT oid FROM pg_database WHERE datname=$1',[name])).rows;
 if(resume){if(existing[0]?.oid!==previous.createdOid)throw new Error('Audit identity changed; refusing resume');}
 else{if(existing.length)throw new Error('Audit database already exists');await admin.query(`CREATE DATABASE ${name} OWNER zyz TEMPLATE template0`);}
 const oid=(await admin.query('SELECT oid FROM pg_database WHERE datname=$1',[name])).rows[0].oid;
 result.createdOid=oid;
 console.log((resume?'Resuming verification of: ':'Created isolated restore database: ')+name);
 if(!resume){
 await admin.query('SET log_parameter_max_length=0; SET log_parameter_max_length_on_error=0');
 await admin.query("SELECT set_config('migration.backup_password',$1,false)",[process.env.MIGRATION_APP_PASSWORD]);
 const script=(await fs.readFile(path.join(repo,'scripts/server-pg-restore-worker.ps1'),'utf8')).replace('__AUDIT_DB__',name).replace('__BACKUP_FILE__',backup.file);
 const program='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
 if(program.length>8000)throw new Error('Restore command too long');
 await admin.query("COPY (SELECT current_setting('migration.backup_password')) TO PROGRAM '"+program.replaceAll("'","''")+"'");
 await admin.query("SELECT set_config('migration.backup_password','',false)");
 }
 let worker;
 for(let attempt=0;attempt<20;attempt++){
  const contents=(await admin.query('SELECT pg_read_file($1,0,100000,true) AS report',[`D:/pgbackups/${name}.report.json`])).rows[0].report;
  if(contents){worker=JSON.parse(contents.replace(/^\uFEFF/,''));break;}
  const active=Number((await admin.query('SELECT count(*) AS n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n);
  if(!active)throw new Error('No restore report or active restore; preserved audit database for inspection');
  console.log('Server restore is still running; waiting for its report...');
  await new Promise(resolve=>setTimeout(resolve,30000));
 }
 if(!worker)throw new Error('Restore report not ready; audit database preserved');
 if(worker.status!=='complete')throw new Error(worker.error??'Restore worker failed');
 await audit.connect();
 for(const [table,expected] of Object.entries(report.tableCounts)){
  if(!/^[a-z_]+$/.test(table))throw new Error('Unexpected table');
  const count=Number((await audit.query(`SELECT count(*) AS n FROM website_data.${table}`)).rows[0].n);
  result.tableCounts[table]=count;if(count!==expected)throw new Error('Restored count differs: '+table);
 }
 const errors=Number((await audit.query("SELECT count(*) AS n FROM website_data.carbon_emission_frames WHERE frame_sha256<>encode(sha256(frame_data),'hex')")).rows[0].n);
 if(errors)throw new Error('Restored carbon hash mismatch');
 result.carbonHashMismatch=errors;result.passed=true;
 await audit.end();
 const check=(await admin.query('SELECT oid FROM pg_database WHERE datname=$1',[name])).rows[0];
 if(!/^zyz_verify_\d+$/.test(name)||name==='zyz'||check?.oid!==oid)throw new Error('Refusing cleanup: audit identity changed');
 await admin.query(`DROP DATABASE ${name}`);
 result.temporaryDatabaseDropped=true;result.finishedAt=new Date().toISOString();
 backup.isolatedRestoreTest=true;backup.restoreTestReport=path.join(output,'server-restore-verification.json');
 await fs.writeFile(reportPath,JSON.stringify(report,null,2));
 console.log(JSON.stringify(result,null,2));
}catch(error){result.error=error.message;throw error;}
finally{
 await audit.end().catch(()=>{});await admin.end().catch(()=>{});
 await fs.writeFile(path.join(output,'server-restore-verification.json'),JSON.stringify(result,null,2));
}
