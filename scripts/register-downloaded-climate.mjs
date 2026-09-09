import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(repo, '.env.local'), quiet: true });
const output = path.join(path.dirname(repo), 'outputs/20260904-climate-model-selection');
const manifest = JSON.parse(await fs.readFile(path.join(output, 'download-manifest.json'), 'utf8'));
const server = JSON.parse(await fs.readFile(path.join(output, 'server-status.json'), 'utf8'));
const files = manifest.files.filter(file => file.filename.endsWith('.nc'));
if (manifest.record_url !== 'https://zenodo.org/records/20501729' || files.some(file => file.record_id !== 20501729) || files.length !== 20 || server.state?.status !== 'complete' || server.state?.completed?.length !== 20 || server.state?.failed?.length !== 0) throw new Error('Local evidence does not prove 20 verified server files');
const completed = new Map(server.state.completed.map(file => [file.file, file]));
for (const file of files) {
  const verified = completed.get(file.filename);
  if (!verified || Number(verified.bytes) !== Number(file.bytes) || `md5:${verified.md5}` !== file.checksum) throw new Error(`Server verification mismatch: ${file.filename}`);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 15000, query_timeout: 30000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('opengridworks-climate-register'))");
  for (const file of files) {
    const match = file.filename.match(/^(.+)_(ssp\d+)_(huss|rsds|tas|sfcwind|ps)_(\d{4})_(\d{4})\.nc$/);
    if (!match || file.download_url !== `https://zenodo.org/api/records/20501729/files/${file.filename}/content` || !/^md5:[a-f0-9]{32}$/.test(file.checksum)) throw new Error(`Invalid manifest entry: ${file.filename}`);
    await client.query(`
      INSERT INTO website_data.climate_projection_sources (
        zenodo_record_id,file_name,gcm,scenario,variable,period_start,period_end,
        spatial_resolution_deg,source_url,expected_size_bytes,md5,license,
        download_status,import_status,source_attributes,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,0.5,$8,$9,$10,$11,'verified','pending',$12,now())
      ON CONFLICT (file_name) DO UPDATE SET
        source_url=EXCLUDED.source_url,expected_size_bytes=EXCLUDED.expected_size_bytes,
        md5=EXCLUDED.md5,license=EXCLUDED.license,download_status='verified',
        import_status=CASE WHEN website_data.climate_projection_sources.import_status='imported' THEN 'imported' ELSE website_data.climate_projection_sources.import_status END,
        source_attributes=website_data.climate_projection_sources.source_attributes || EXCLUDED.source_attributes,
        updated_at=now()
    `, [20501729,file.filename,match[1].toLowerCase(),match[2],match[3],`${match[4]}-01-01`,`${match[5]}-12-31`,file.download_url,Number(file.bytes),file.checksum.slice(4),manifest.license,{ zenodoRecordUrl:'https://zenodo.org/records/20501729', serverDirectory:server.state.directory, serverFileVerified:true, truthStatus:'published-model-scenario-not-observation' }]);
  }
  await client.query(`
    INSERT INTO website_data.dataset_catalog (
      dataset_key,earth_layer,name,provider,source_url,data_type,spatial_scope,
      source_resolution_deg,project_resolution_deg,temporal_resolution,
      coverage_start,coverage_end,access_method,auth_required,license,
      acquisition_status,database_status,database_relation,priority,notes,metadata
    ) VALUES (
      'zenodo-gfdl-esm4-ssp126-hourly-climate','气象地球',
      'GFDL-ESM4 SSP1-2.6 hourly climate projections','Chen et al. / Zenodo',
      'https://zenodo.org/records/20501729','NetCDF: huss, ps, rsds, sfcwind, tas',
      'mainland China',0.5,0.5,'hourly','2021-01-01','2060-12-31',
      'public Zenodo HTTPS',false,'CC-BY-4.0','downloaded','pending',
      'website_data.climate_projection_daily','high',
      '服务器20个NetCDF已完成大小与MD5校验；数据库导入尚未开始。属于长期模型情景，不是观测或天气预报。',$1
    ) ON CONFLICT (dataset_key) DO UPDATE SET
      acquisition_status=EXCLUDED.acquisition_status,
      database_status=CASE WHEN website_data.dataset_catalog.database_status='imported' THEN 'imported' ELSE EXCLUDED.database_status END,
      notes=EXCLUDED.notes,metadata=website_data.dataset_catalog.metadata || EXCLUDED.metadata,updated_at=now()
  `, [{ recordId:20501729, verifiedServerFiles:20, expectedBytes:files.reduce((sum,file)=>sum+Number(file.bytes),0), variables:['huss','ps','rsds','sfcwind','tas'], truthStatus:'published-model-scenario-not-observation' }]);
  const result = await client.query(`SELECT count(*)::int AS sources,count(*) FILTER (WHERE download_status='verified')::int AS verified,count(*) FILTER (WHERE import_status='pending')::int AS pending FROM website_data.climate_projection_sources WHERE zenodo_record_id=20501729`);
  await client.query('COMMIT');
  console.log(JSON.stringify({ registered:true, ...result.rows[0] }));
} catch (error) {
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
} finally {
  await Promise.race([client.end().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1000))]);
  client.connection?.stream?.destroy();
}
