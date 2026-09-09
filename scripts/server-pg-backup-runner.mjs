import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(path.dirname(repo),'outputs/20260904-pg-migration');
const id='zyz-server-'+new Date().toISOString().replaceAll(/[^0-9TZ]/g,'');
const remoteReport=`D:/pgbackups/${id}.report.json`;
const script=(await fs.readFile(path.join(repo,'scripts/server-pg-backup-worker.ps1'),'utf8')).replace('__BACKUP_ID__',id);
const program='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
if(program.length>8000)throw new Error('Server command too long');
const client=new Client({host:'218.197.118.49',port:5432,database:'zyz',user:'postgres',password:process.env.MIGRATION_ADMIN_PASSWORD,ssl:false,connectionTimeoutMillis:15000,query_timeout:600000,keepAlive:true,keepAliveInitialDelayMillis:10000});
client.on('error',error=>console.error(error.message));
async function loadWebsiteDataTableCounts(){
 const tableRows=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='website_data' ORDER BY tablename")).rows;
 const tableCounts={};
 for(const row of tableRows){
  if(!/^[a-z_]+$/.test(row.tablename))throw new Error('Unexpected website_data table name: '+row.tablename);
  const name='"'+row.tablename.replaceAll('"','""')+'"';
  tableCounts[row.tablename]=Number((await client.query(`SELECT count(*) AS n FROM website_data.${name}`)).rows[0].n);
 }
 return tableCounts;
}
try {
 await client.connect();
 const identity=(await client.query('SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,version()')).rows[0];
 if(identity.db!=='zyz'||identity.role!=='postgres'||identity.host!=='218.197.118.49'||!identity.version.includes('windows'))throw new Error('Target identity mismatch');
 // Redact bind values from this management session's logging. Statement logging
 // stays unchanged; only the session's credential parameter values are hidden.
 await client.query('SET log_parameter_max_length=0; SET log_parameter_max_length_on_error=0');
 await client.query("SELECT set_config('migration.backup_password',$1,false)",[process.env.MIGRATION_APP_PASSWORD]);
 await fs.writeFile(path.join(output,'server-backup-state.json'),JSON.stringify({status:'running',id,remoteReport,startedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({identity,remoteReport,action:'server-local backup; no data or authentication-rule changes'}));
 await client.query("COPY (SELECT current_setting('migration.backup_password')) TO PROGRAM '"+program.replaceAll("'","''")+"'");
 await client.query("SELECT set_config('migration.backup_password','',false)");
 const contents=(await client.query('SELECT pg_read_file($1) AS report',[remoteReport])).rows[0].report;
 const result=JSON.parse(contents.replace(/^\uFEFF/,''));
 await fs.writeFile(path.join(output,'server-backup-result.json'),JSON.stringify(result,null,2));
 await fs.writeFile(path.join(output,'server-backup-state.json'),JSON.stringify({status:result.status,id,remoteReport,finishedAt:new Date().toISOString()},null,2));
 if(result.status!=='complete')throw new Error(result.error??'Server backup failed');
 const reportPath=path.join(output,'final-verification.json');
 const report=JSON.parse((await fs.readFile(reportPath,'utf8')).replace(/^\uFEFF/,''));
 report.tableCounts=await loadWebsiteDataTableCounts();
 report.verifiedAt=new Date().toISOString();
 report.identity=identity;
 report.backup=result;await fs.writeFile(reportPath,JSON.stringify(report,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{await client.end().catch(()=>{});}
