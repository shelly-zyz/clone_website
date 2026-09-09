import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from 'pg';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.dirname(repo), output=path.join(workspace,'outputs/20260904-pg-migration');
const state=JSON.parse(await fs.readFile(path.join(output,'migration-state.json'),'utf8'));
if(state.status!=='local-core-restored-verified')throw new Error('Core migration must finish and verify before finalization');
const audit=JSON.parse(await fs.readFile(path.join(output,'carbon-source-audit.json'),'utf8'));
const client=new Client({connectionString:process.env.DATABASE_URL,ssl:false,connectionTimeoutMillis:15000,query_timeout:300000,
  keepAlive:true,keepAliveInitialDelayMillis:10000});
client.on('error',error=>console.error('Finalization connection: '+String(error.message).replaceAll(process.env.PGPASSWORD,'[REDACTED]')));
let clientClosed=false;
const sql=async(q,args=[])=> (await client.query(q,args)).rows;
const hash=async file=>{const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');};
async function backupRestoredDatabase(){
  const file=path.join(output,'zyz-restored-'+new Date().toISOString().replaceAll(/[^0-9TZ]/g,'')+'.dump');
  try {
  for(const [command,args] of [['pg_dump.exe',['--format=custom','--no-owner','--no-privileges','--file',file]],['pg_restore.exe',['--list',file]]]){
    await new Promise((resolve,reject)=>{const c=spawn(path.join('C:/Program Files/PostgreSQL/17/bin',command),args,
      {env:process.env,windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';c.stderr.on('data',b=>{error+=b;});c.on('error',reject);c.on('close',code=>code===0?resolve():reject(new Error(command+': '+error)));});
  }
  return {status:'complete',file,bytes:(await fs.stat(file)).size,sha256:await hash(file),archiveListVerified:true,isolatedRestoreTest:false};
  }catch(error){error.backupFile=file;throw error;}
}
async function registerSources(){
  const records=[];
  async function record(relative,dataset,sha256,status,count=null,error=null){
    const file=path.resolve(workspace,relative),safe=path.relative(workspace,file);
    if(safe.startsWith('..')||path.isAbsolute(safe))throw new Error('Source path outside workspace');
    try{const stat=await fs.stat(file);records.push({path:safe.replaceAll('\\','/'),dataset,source_kind:'local-client-source; original not copied to server disk',
      media_type:'application/octet-stream',size_bytes:stat.size,modified_at:stat.mtime.toISOString(),sha256,import_status:status,record_count:count,error});}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  for(const item of audit.records){
    const m=JSON.parse(await fs.readFile(path.join(workspace,item.manifest),'utf8'));
    const good=!item.badFrames.length&&item.archive.matches;
    await record(item.manifest,'carbon-graced',await hash(path.join(workspace,item.manifest)),good?'source-manifest':'quarantined-source');
    await record(m.source.localArchivePath,'carbon-graced',item.archive.actualHash??null,good?'local-source-only':'quarantined-source',null,good?null:'Archive/frame hashes differ from historical manifest; not imported');
    await record(m.source.localNetcdfPath,'carbon-graced',null,'local-source-unverified-hash');
    for(const f of m.frames){const bad=item.badFrames.find(b=>b.path===f.path);
      await record(f.path,'carbon-graced',bad?.actualHash??f.sha256,good?'imported':'quarantined-source',good?1:null,bad?'Frame hash/size differs from manifest':good?null:'Month quarantined because archive or other frames differ');}
  }
  for(const name of await fs.readdir(path.join(workspace,'data/gispo-vre-potential'))){
    if(!name.endsWith('.csv'))continue;const relative='data/gispo-vre-potential/'+name;await record(relative,'gispo',await hash(path.join(workspace,relative)),'imported-derived');}
  for(const name of await fs.readdir(path.join(repo,'.weather-cache'))){
    if(!name.endsWith('.json'))continue;const relative=path.relative(workspace,path.join(repo,'.weather-cache',name));await record(relative,'weather-gfs',await hash(path.join(workspace,relative)),name==='manifest.json'?'source-manifest':'imported',name==='manifest.json'?null:1);}
  for(const name of ['14292571.zip','14526360.zip','China Hydropower Station Dataset.zip','china-260517.osm.pbf',
    'CPVPD-2024.zip','gem-data.zip','globalpowerplantdatabasev130.zip','VRE_gfdl-esm4_ssp126_2021_2060.mat']){
    const relative='data/'+name;await record(relative,'power-source',await hash(path.join(workspace,relative)),'local-source-only');}
  for(let i=0;i<records.length;i+=500){
    await client.query(`INSERT INTO website_data.source_files (path,dataset,source_kind,media_type,size_bytes,modified_at,sha256,import_status,record_count,error)
      SELECT path,dataset,source_kind,media_type,size_bytes,modified_at,sha256,import_status,record_count,error
      FROM jsonb_to_recordset($1::jsonb) AS r(path text,dataset text,source_kind text,media_type text,size_bytes bigint,modified_at timestamptz,sha256 text,import_status text,record_count bigint,error text)
      ON CONFLICT(path) DO UPDATE SET dataset=EXCLUDED.dataset,source_kind=EXCLUDED.source_kind,sha256=EXCLUDED.sha256,import_status=EXCLUDED.import_status,
      record_count=EXCLUDED.record_count,error=EXCLUDED.error,imported_at=now()`,[JSON.stringify(records.slice(i,i+500))]);
  }
}
try {
  await client.connect();
  const identity=(await sql('SELECT current_database() AS db,host(inet_server_addr()) AS host,version()'))[0];
  if(identity.db!=='zyz'||identity.host!=='218.197.118.49'||!identity.version.includes('windows'))throw new Error('Target mismatch');
  const extras=audit.records.filter(r=>r.manifest.includes('scratch')&&!r.badFrames.length&&r.archive.matches);
  for(const item of extras){
    console.log(`Restoring verified additional month: ${item.sector}/${item.month}`);
    await new Promise((resolve,reject)=>{const c=spawn(process.execPath,['scripts/import-carbon-graced.mjs','--manifest',path.join(workspace,item.manifest)],
      {cwd:repo,env:process.env,windowsHide:true,stdio:['ignore','inherit','inherit']});c.on('error',reject);c.on('close',code=>code===0?resolve():reject(new Error('Additional month failed')));});
  }
  await client.query('BEGIN');
  try {
    await registerSources();
    const docs=await sql('SELECT path,dataset,payload FROM website_data.json_documents ORDER BY path');
    for(const doc of docs){
      const name=path.basename(doc.path), candidate=name.includes('candidate');
      const urls=[];
      function collect(value){if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object'){
        for(const [key,v] of Object.entries(value)){if(typeof v==='string'&&/url|zenodo|paper|code/i.test(key)&&/^https?:/.test(v))urls.push(v);else if(typeof v==='object')collect(v);}}}
      collect(doc.payload);
      if(doc.dataset==='china-pv')urls.push('https://doi.org/10.5281/zenodo.15618227','https://doi.org/10.5281/zenodo.14292571');
      if(doc.dataset==='osm-power')urls.push('https://download.geofabrik.de/asia/china.html');
      if(candidate)urls.push('https://www.wri.org/aqueduct');
      const status=candidate?'metadata-only':'imported';
      const metadata={sourcePath:doc.path,sourceUrls:[...new Set(urls)],documentOnly:true,truthStatus:candidate?'candidate-metadata':name==='official-totals.json'?'official-statistics':'source-derived-summary',
        rowCount:1,missingRate:null,notes:candidate?'仅候选图层状态，未生成暴露结果，不属于已恢复的风险数据。':'按sourcePath精确查询，避免将汇总与明细相加。'};
      await client.query(`INSERT INTO website_data.dataset_catalog (dataset_key,earth_layer,name,provider,source_url,data_type,spatial_scope,access_method,acquisition_status,database_status,database_relation,metadata,notes)
        VALUES ($1,'电力地球',$2,'see document source fields',$3,'JSON metadata/summary','China','local verified file','downloaded',$4,'website_data.json_documents',$5::jsonb,$6)
        ON CONFLICT(dataset_key) DO UPDATE SET metadata=EXCLUDED.metadata,database_status=EXCLUDED.database_status,updated_at=now()`,
        ['document-'+doc.dataset+'-'+name,name,urls[0]??'https://www.nea.gov.cn/',status,JSON.stringify(metadata),metadata.notes]);
    }
    const carbon=await sql('SELECT sector,count(*)::int AS rows,min(observed_on)::text AS start,max(observed_on)::text AS end FROM website_data.carbon_emission_frames GROUP BY sector');
    for(const sector of ['Power','total','Industry','Residential','GroundTransportation','DomesticAviation','InternationalAviation','InternationalShipping']){
      const data=carbon.find(x=>x.sector===sector);const bad=audit.records.filter(r=>r.sector===sector&&(r.badFrames.length||!r.archive.matches));
      const status=data?(sector==='Power'?'imported':'partial'):bad.length?'quarantined-source':'not-imported';
      const metadata={rowCount:data?.rows??0,coverageStart:data?.start??null,coverageEnd:data?.end??null,
        unit:'kgC/h',truthStatus:'published-emission-estimate',missingRate:null,
        quarantinedMonths:bad.map(r=>({month:r.month,badFrames:r.badFrames.length,archiveMatches:r.archive.matches})),
        notes:sector==='Power'?'Power已校验恢复至2026-05；其他部门独立统计，不能与total重复相加。':'部分或缺失部门；未把零散月份伪装成连续历史。'};
      await client.query(`INSERT INTO website_data.dataset_catalog (dataset_key,earth_layer,name,provider,source_url,data_type,spatial_scope,access_method,acquisition_status,database_status,database_relation,coverage_start,coverage_end,source_resolution_deg,project_resolution_deg,notes,metadata)
        VALUES ($1,'碳地球',$2,'Carbon Monitor GRACED','https://carbonmonitor-graced.com/','daily emission grid','global','verified local restoration',$3,$4,'website_data.carbon_emission_frames',$5,$6,0.1,0.1,$7,$8::jsonb)
        ON CONFLICT(dataset_key) DO UPDATE SET database_status=EXCLUDED.database_status,coverage_start=EXCLUDED.coverage_start,coverage_end=EXCLUDED.coverage_end,
        source_resolution_deg=EXCLUDED.source_resolution_deg,project_resolution_deg=EXCLUDED.project_resolution_deg,notes=EXCLUDED.notes,metadata=EXCLUDED.metadata,updated_at=now()`,
        ['graced-'+sector.toLowerCase(),'GRACED '+sector,data?'downloaded':bad.length?'hash-mismatch':'missing-local-source',status,data?.start??null,data?.end??null,metadata.notes,JSON.stringify(metadata)]);
    }
    for(const [schema,earth] of [['weather','气象地球'],['power','电力地球'],['carbon','碳地球']]){
      await client.query(`CREATE OR REPLACE VIEW ${schema}.dataset_catalog AS SELECT * FROM website_data.dataset_catalog WHERE earth_layer='${earth}'`);
      await client.query(`COMMENT ON SCHEMA ${schema} IS '${earth}分类查询视图；真实数据保存在website_data，避免重复存储'`);
    }
    await client.query(`CREATE OR REPLACE VIEW power.json_documents AS SELECT * FROM website_data.json_documents WHERE dataset IN ('china-pv','china-validation','climate-vre','osm-power')`);
    await client.query(`CREATE OR REPLACE VIEW power.vector_tiles AS SELECT * FROM website_data.vector_tiles WHERE dataset='osm-power'`);
    await client.query(`CREATE OR REPLACE VIEW shared.file_inventory AS SELECT *,CASE WHEN dataset='natural-earth' THEN '共用基础'
      WHEN dataset='carbon-graced' THEN '碳地球' WHEN dataset='weather-gfs' THEN '气象地球' WHEN dataset IN ('gispo','power-source') THEN '电力地球'
      WHEN dataset IN ('china-pv','china-validation','climate-vre','osm-power','generated-map') THEN '电力地球' ELSE '待分类' END AS earth_layer
      FROM website_data.source_files`);
    await client.query(`COMMENT ON COLUMN website_data.energy_assets.capacity_mw IS 'MW；来源设施口径，不等于官方省级总装机；须结合status区分已投运/规划项目'`);
    await client.query(`COMMENT ON COLUMN website_data.climate_vre_hourly.values_json IS '公开模型情景的量化容量因子序列，按scale解码；不是实测出力'`);
    await client.query(`COMMENT ON COLUMN website_data.carbon_emission_frames.frame_data IS '来源估算排放，gzip压缩Float32；单位kgC/h；不能直接冒充kgCO2；保留原编码零值/缺失解释'`);
    await client.query(`UPDATE website_data.dataset_catalog SET coverage_start=(metadata->>'coverageStart')::date,coverage_end=(metadata->>'coverageEnd')::date
      WHERE metadata->>'coverageStart' IS NOT NULL AND metadata->>'coverageEnd' IS NOT NULL`);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}
  const checks={
    carbonHashMismatch:Number((await sql("SELECT count(*) AS n FROM website_data.carbon_emission_frames WHERE frame_sha256<>encode(sha256(frame_data),'hex')"))[0].n),
    weatherHashMismatch:Number((await sql("SELECT count(*) AS n FROM website_data.weather_forecast_fields WHERE payload_sha256<>encode(sha256(payload_json_gzip),'hex')"))[0].n),
    badVreLength:Number((await sql('SELECT count(*) AS n FROM website_data.climate_vre_hourly WHERE jsonb_array_length(values_json)<>hours'))[0].n),
    invalidAssetCoordinates:Number((await sql('SELECT count(*) AS n FROM website_data.energy_assets WHERE latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180'))[0].n),
    failedFiles:Number((await sql("SELECT count(*) AS n FROM website_data.source_files WHERE import_status='error'"))[0].n),
    powerDays:Number((await sql("SELECT count(*) AS n FROM website_data.carbon_emission_frames WHERE sector='Power' AND observed_on BETWEEN '2019-01-01' AND '2026-05-31'"))[0].n),
    totalDays:Number((await sql("SELECT count(*) AS n FROM website_data.carbon_emission_frames WHERE sector='total' AND observed_on BETWEEN '2021-03-01' AND '2021-03-31'"))[0].n),
    fullOsm:Number((await sql('SELECT count(*) AS n FROM power.osm_features'))[0].n)};
  const passed=checks.carbonHashMismatch===0&&checks.weatherHashMismatch===0&&checks.badVreLength===0&&checks.invalidAssetCoordinates===0&&checks.failedFiles===0&&checks.powerDays===2708&&checks.totalDays===31&&checks.fullOsm===1004207;
  const tableCounts={};for(const row of await sql("SELECT tablename FROM pg_tables WHERE schemaname='website_data' ORDER BY tablename")){
    const name='"'+row.tablename.replaceAll('"','""')+'"';tableCounts[row.tablename]=Number((await sql(`SELECT count(*) AS n FROM website_data.${name}`))[0].n);}
  const catalog=await sql('SELECT dataset_key,earth_layer,name,provider,source_url,database_status,database_relation,coverage_start::text,coverage_end::text,metadata FROM website_data.dataset_catalog ORDER BY earth_layer,dataset_key');
  const report={verifiedAt:new Date().toISOString(),identity,checksPassed:passed,checks,tableCounts,catalog,
    databaseBytes:(await sql('SELECT pg_database_size(current_database()) AS bytes'))[0].bytes,
    limitations:['20 climate NetCDF files still missing locally','two scratch months quarantined due to frame/archive hash mismatches',
      'raw source archives and MAT/NetCDF/PBF originals remain on the current computer; not copied to server disk','PostGIS not installed; no AI privileges configured',
      'connection uses existing campus VPN; PostgreSQL itself has SSL disabled']};
  await fs.writeFile(path.join(output,'final-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checksPassed:passed,checks,tableCounts,databaseBytes:report.databaseBytes},null,2));
  if(!passed)throw new Error('Final data verification failed');
  // pg_dump uses its own connection. Avoid keeping this connection idle during
  // a potentially lengthy network backup after all SQL verification is done.
  await client.end();clientClosed=true;
  console.log('Creating complete post-migration database backup...');
  let backupFailure;
  try{report.backup=await backupRestoredDatabase();}
  catch(error){
    backupFailure=error;
    report.backup={status:'failed',file:error.backupFile,archiveListVerified:false,isolatedRestoreTest:false,
      error:String(error.message).replaceAll(process.env.PGPASSWORD,'[REDACTED]')};
  }
  await fs.writeFile(path.join(output,'final-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({backup:report.backup}));
  const md=['# 新PG实际迁移清单','',`核验时间：${report.verifiedAt}；目标：218.197.118.49 / zyz；本页不含密码。`,'',
    '| 所属地球 | 数据集 | 状态 | 实际条数 | 来源 |','|---|---|---|---:|---|',
    ...catalog.map(r=>`| ${r.earth_layer} | ${r.name} | ${r.database_status} | ${r.metadata.rowCount??r.metadata.projectRows??'见表统计'} | [来源](${r.source_url}) |`),
    '','## 目标表精确行数','','| 表 | 行数 |','|---|---:|',...Object.entries(tableCounts).map(([t,n])=>`| website_data.${t} | ${n} |`),
    '','## 查询入口','','- weather：气象；power：电力；carbon：碳；shared：共用目录和边界。',
    '- 这些是查询视图，不复制数据；原网站继续使用website_data。',
    '- Power包含2708日（2019-01-01至2026-05-31）；total仅2021-03共31日，不能与Power相加。',
    '- GFS是2026-07-26历史真实预报，VRE为2021—2060模型情景。',
    '- 两个临时月份校验不一致已隔离，原文件保留；20个气候NetCDF仍待补下载。',
    `- 迁移后备份：${report.backup.status}；备份失败时现有dump不能当作可恢复完整备份。`,
    '- 原始大文件仍在当前电脑，本轮没有复制到服务器D盘；PostGIS与AI权限未配置。',''];
  await fs.writeFile(path.join(output,'新PG实际迁移清单.md'),md.join('\n'));
  if(backupFailure)throw backupFailure;
}finally{if(!clientClosed)await client.end().catch(()=>{});}
