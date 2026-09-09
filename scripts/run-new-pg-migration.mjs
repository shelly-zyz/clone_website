import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.dirname(repo);
const output = path.join(workspace, 'outputs', '20260904-pg-migration');
const python = path.join(output, 'venv', 'Scripts', 'python.exe');
const pgBin = 'C:/Program Files/PostgreSQL/17/bin';
const journalPath = path.join(output, 'migration-state.json');
const mode = process.argv[2] ?? 'restore';
if (!['restore', 'verify', 'finalize'].includes(mode)) throw new Error('Unknown migration mode');
if (!process.env.PGPASSWORD) throw new Error('Use the secure PowerShell launcher');
function createControlClient() {
  const connection = new Client({host:'218.197.118.49', port:5432, database:'zyz', user:'zyz',
    password:process.env.PGPASSWORD, ssl:false, connectionTimeoutMillis:15000, query_timeout:300000,
    keepAlive:true, keepAliveInitialDelayMillis:10000});
  connection.on('error', error => console.error('Migration control connection: '+
    String(error.message).replaceAll(process.env.PGPASSWORD,'[REDACTED]')));
  return connection;
}
let client = createControlClient();
let journal;
const stamp = () => new Date().toISOString();
const save = async () => fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
async function run(label, command, args, quiet = false) {
  console.log(`[${stamp()}] ${label}`);
  const log = createWriteStream(path.join(output, `${label}.log`), {flags:'a'});
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {cwd:repo, env:process.env, windowsHide:true, stdio:['ignore','pipe','pipe']});
      let tail = '';
      const consume = data => {
        const safe = data.toString().replaceAll(process.env.PGPASSWORD, '[REDACTED]');
        log.write(safe); tail = (tail + safe).slice(-3000);
        if (!quiet) process.stdout.write(safe);
      };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`${label} failed (${code}): ${tail}`)));
    });
  } finally { await new Promise(resolve => log.end(resolve)); }
}
async function stage(key, fn) {
  if (journal.completed.includes(key)) { console.log(`Previously completed: ${key}`); return; }
  journal.active = key; journal.status = 'running'; delete journal.error; journal.updatedAt = stamp(); await save();
  await fn(); journal.completed.push(key); journal.active = null; journal.updatedAt = stamp(); await save();
}
async function catalog(key, earth, name, provider, url, relation, count, metadata = {}, status='imported') {
  await client.query(`INSERT INTO website_data.dataset_catalog
    (dataset_key,earth_layer,name,provider,source_url,data_type,spatial_scope,access_method,
     acquisition_status,database_status,database_relation,notes,metadata)
    VALUES ($1,$2,$3,$4,$5,'source-backed dataset','see metadata','local source restoration',
      $6,$7,$8,$9,$10::jsonb)
    ON CONFLICT(dataset_key) DO UPDATE SET earth_layer=EXCLUDED.earth_layer,
      name=EXCLUDED.name,provider=EXCLUDED.provider,source_url=EXCLUDED.source_url,
      database_status=EXCLUDED.database_status,database_relation=EXCLUDED.database_relation,
      notes=EXCLUDED.notes,metadata=EXCLUDED.metadata,updated_at=now()`,
    [key,earth,name,provider,url,status==='imported'?'downloaded':'missing-local-source',status,
     relation,metadata.notes ?? '恢复数量按新库实测；未知缺失率不填0。',
     JSON.stringify({rowCount:count,verifiedAt:stamp(),migrationBatch:'20260904',missingRate:null,...metadata})]);
}
async function govern() {
  await client.query('BEGIN');
  try {
    const count = async table => Number((await client.query(`SELECT count(*) AS n FROM website_data.${table}`)).rows[0].n);
    await catalog('project-energy-assets','电力地球','中国真实能源设施','WRI / GEM / 水电公开数据',
      'https://datasets.wri.org/dataset/globalpowerplantdatabase','website_data.energy_assets',await count('energy_assets'),
      {truthStatus:'published-source-derived',units:{capacity_mw:'MW'},notes:'地图匹配设施口径；不等于官方省级装机。来源逐行保留source。'});
    await catalog('peeringdb-china-facilities','电力地球','PeeringDB中国数据中心','PeeringDB','https://www.peeringdb.com/apidocs/',
      'website_data.data_centers',await count('data_centers'),{truthStatus:'published-source-derived',rawApiResponseAvailable:false});
    await catalog('climate-vre-gfdl-ssp126','电力地球','2021—2060风光容量因子情景','Ruijie Chen et al.','https://doi.org/10.5281/zenodo.17445329',
      'website_data.climate_vre_hourly',await count('climate_vre_hourly'),{truthStatus:'model-scenario',coverageStart:'2021-01-01',coverageEnd:'2060-12-31',
        units:{capacity_factor:'1',capacity_mw:'MW'},notes:'正式模型情景，不是实测发电；固定地图装机换算及原始metadata保留，部分网格有空间回退匹配。'});
    const layers=(await client.query('SELECT source_path,count(*)::int AS n FROM website_data.geo_features GROUP BY source_path ORDER BY source_path')).rows;
    for(const layer of layers){
      const shared=layer.source_path.includes('/natural-earth/');
      const name=path.basename(layer.source_path);
      await catalog('geo-'+name,shared?'共用基础':'电力地球',name,shared?'Natural Earth':'OpenStreetMap',
        shared?'https://www.naturalearthdata.com/':'https://download.geofabrik.de/asia/china.html','website_data.geo_features',layer.n,
        {sourcePath:layer.source_path,truthStatus:'published-source-derived',previewOnly:name.includes('preview'),
          notes:'按source_path查询此数据集；预览几何不能与完整图层重复计数。'});
    }
    await catalog('osm-power-display-tiles','电力地球','OSM电网显示瓦片','OpenStreetMap','https://download.geofabrik.de/asia/china.html',
      'website_data.vector_tiles',await count('vector_tiles'),{truthStatus:'published-source-derived',displayOnly:true});
    for(const row of (await client.query(`SELECT sector,count(*)::int AS n,min(observed_on)::text AS start,max(observed_on)::text AS end FROM website_data.carbon_emission_frames GROUP BY sector`)).rows){
      await catalog('graced-'+row.sector.toLowerCase(),'碳地球','GRACED '+row.sector,'Carbon Monitor GRACED','https://carbonmonitor-graced.com/',
        'website_data.carbon_emission_frames',row.n,{truthStatus:'published-emission-estimate',coverageStart:row.start,coverageEnd:row.end,
          units:{emission:'kgC/h'},spatialResolutionDeg:0.1,notes:'来源估算栅格，不冒充传感器实测；保留既有编码，0/缺失解释须结合原始NetCDF，未虚报像元缺失率。'});
    }
    await catalog('cmip6-climate-source-gap','气象地球','待补回20个气候NetCDF','Zenodo','https://doi.org/10.5281/zenodo.20501729',
      'website_data.climate_projection_daily',0,{expectedSourceFiles:20,truthStatus:'model-scenario',notes:'本轮本地未找到原始文件，历史73050日块不能计为已恢复。'},'not-imported');
    await client.query(`UPDATE website_data.dataset_catalog SET earth_layer='电力地球' WHERE dataset_key='gispo-global-renewable-resource-era5-2019'`);
    for(const schema of ['weather','power','carbon','shared']) await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    const views={weather:['weather_forecast_fields','climate_projection_sources','climate_projection_grids','climate_projection_daily'],
      power:['energy_assets','data_centers','climate_vre_hourly','renewable_resource_potential'],
      carbon:['carbon_source_archives','carbon_emission_frames','carbon_emission_frame_chunks'],shared:['source_files','import_runs','dataset_catalog']};
    for(const [schema,tables] of Object.entries(views)) for(const table of tables)
      await client.query(`CREATE OR REPLACE VIEW ${schema}.${table} AS SELECT * FROM website_data.${table}`);
    await client.query(`CREATE OR REPLACE VIEW power.osm_features AS SELECT * FROM website_data.geo_features
      WHERE source_path LIKE '%/osm-power/china-power-%.geojson'`);
    await client.query(`CREATE OR REPLACE VIEW shared.boundaries AS SELECT * FROM website_data.geo_features WHERE source_path LIKE '%/natural-earth/%'`);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}
async function verify() {
  const queries={
    tables:`SELECT relname,n_live_tup FROM pg_stat_user_tables WHERE schemaname='website_data' ORDER BY relname`,
    assets:'SELECT source,count(*)::int AS rows FROM website_data.energy_assets GROUP BY source ORDER BY source',
    centers:'SELECT count(*)::int AS rows FROM website_data.data_centers',
    vre:'SELECT count(*)::int AS rows,min(year),max(year),count(DISTINCT region_id)::int AS regions FROM website_data.climate_vre_hourly',
    osm:'SELECT source_path,count(*)::int AS rows FROM website_data.geo_features GROUP BY source_path ORDER BY source_path',
    tiles:'SELECT count(*)::int AS rows FROM website_data.vector_tiles',
    potential:'SELECT technology,count(*)::int AS rows,sum(source_cell_count)::int AS source_cells FROM website_data.renewable_resource_potential GROUP BY technology ORDER BY technology',
    weather:'SELECT count(*)::int AS rows,min(run_time_utc)::text AS earliest,max(valid_time_utc)::text AS latest FROM website_data.weather_forecast_fields',
    carbon:"SELECT sector,count(*)::int AS rows,count(*) FILTER (WHERE observed_on BETWEEN '2019-01-01' AND '2026-04-30')::int AS core_rows,min(observed_on)::text AS start,max(observed_on)::text AS end FROM website_data.carbon_emission_frames GROUP BY sector",
    catalog:'SELECT earth_layer,database_status,count(*)::int AS datasets FROM website_data.dataset_catalog GROUP BY earth_layer,database_status ORDER BY 1,2',
    fileErrors:"SELECT path,error FROM website_data.source_files WHERE import_status='error'",
    size:'SELECT pg_database_size(current_database()) AS bytes'};
  const result={verifiedAt:stamp(),target:{host:'218.197.118.49',database:'zyz'}};
  for(const [key,sql] of Object.entries(queries)) result[key]=(await client.query(sql)).rows;
  const failures=[];
  if(result.assets.reduce((s,r)=>s+r.rows,0)!==9143) failures.push('energy assets');
  if(result.centers[0].rows!==24) failures.push('data centers');
  if(result.vre[0].rows!==2560 || result.vre[0].regions!==32) failures.push('VRE');
  if(result.tiles[0].rows!==224) failures.push('tiles');
  if(result.potential.reduce((s,r)=>s+r.rows,0)!==222943 || result.potential.reduce((s,r)=>s+r.source_cells,0)!==773653) failures.push('GISPO');
  if(result.weather[0].rows!==13) failures.push('GFS');
  const power=result.carbon.find(r=>r.sector==='Power');
  if(!power || power.core_rows!==2677 || power.start!=='2019-01-01' || power.end<'2026-04-30') failures.push('GRACED Power');
  if(result.fileErrors.length) failures.push('source file errors');
  result.checksPassed=failures.length===0; result.failures=failures;
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(failures.length) throw new Error('Verification failed: '+failures.join(', '));
}
await fs.mkdir(output,{recursive:true});
try {
  if(mode==='restore') {
    try {journal=JSON.parse(await fs.readFile(journalPath,'utf8'));} catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await client.connect();
  const identity=(await client.query(`SELECT version(),current_database() AS db,current_user AS role,
    host(inet_server_addr()) AS address,has_database_privilege(current_user,current_database(),'CREATE') AS can_create`)).rows[0];
  console.log(JSON.stringify({identity}));
  if(identity.db!=='zyz'||identity.role!=='zyz'||identity.address!=='218.197.118.49'||!identity.version.includes('windows')||!identity.can_create)
    throw new Error('Target identity or schema privilege mismatch');
  if(mode==='finalize'){
    await client.end(); client=null;
    await run('finalize-governance',process.execPath,['scripts/finalize-new-pg-migration.mjs']);
  }
  else if(mode==='verify'){await verify();}
  else {
    if(!journal){
      const tables=(await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows;
      if(tables.length)throw new Error('Target has existing tables and no migration journal; refusing overwrite');
      journal={createdAt:stamp(),identity,completed:[],active:null,status:'preparing'}; await save();
    }
    await stage('empty-target-backup',async()=>{
      const dump=path.join(output,'zyz-before-import.dump');
      try {await fs.access(dump);throw new Error('Backup path already exists; inspect before rerun');} catch(error){if(error.code!=='ENOENT')throw error;}
      await run('backup',path.join(pgBin,'pg_dump.exe'),['--format=custom','--no-owner','--no-privileges','--file',dump],true);
      await run('backup-list',path.join(pgBin,'pg_restore.exe'),['--list',dump],true);
      const bytes=await fs.readFile(dump);journal.backup={file:dump,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),restoreTest:'archive listed; no isolated restore database privilege'};
    });
    await stage('schema',async()=>{await client.query('BEGIN');try{await client.query(await fs.readFile(path.join(repo,'scripts/database-schema.sql'),'utf8'));await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}});
    // Each importer owns its connection. Do not leave a control connection idle
    // for a long migration: a network timeout must not abort a committed batch.
    await client.end(); client=null;
    await stage('website-core',()=>run('website-core',process.execPath,['--max-old-space-size=2048','scripts/import-data-to-postgres.mjs']));
    await stage('gispo',()=>run('gispo',python,['scripts/import-renewable-resource-potential.py']));
    await stage('weather',()=>run('weather',python,['scripts/import-weather-cache-to-postgres.py']));
    await stage('full-osm',()=>run('full-osm',python,['scripts/stream-osm-to-postgres.py']));
    const carbonRoot=path.join(workspace,'data/carbon-graced/processed/Power');
    for(const month of (await fs.readdir(carbonRoot)).filter(x=>/^\d{4}-\d{2}$/.test(x)).sort()){
      await stage('carbon-Power-'+month,()=>run('carbon-Power-'+month,process.execPath,
        ['scripts/import-carbon-graced.mjs','--manifest',path.join(carbonRoot,month,'manifest.json')],true));
    }
    client=createControlClient(); await client.connect();
    await stage('classification',govern);
    await verify();
    journal.status='local-core-restored-verified';journal.updatedAt=stamp();await save();
  }
} catch(error) {
  if(journal){journal.status='stopped';journal.error=String(error.message).replaceAll(process.env.PGPASSWORD,'[REDACTED]');journal.updatedAt=stamp();await save();}
  console.error(String(error.message).replaceAll(process.env.PGPASSWORD,'[REDACTED]'));process.exitCode=1;
} finally {if(client) await client.end().catch(()=>{});}
