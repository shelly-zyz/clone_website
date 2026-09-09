import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=new URL(process.argv[2]??'http://127.0.0.1:3009');
if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw new Error('Use a local verification server');
const report={verifiedAt:new Date().toISOString(),checks:[],failures:[]};
async function check(name,route,validate,expectedStatus=200,binary=false){
  try {
    const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(90000)});
    if(response.status!==expectedStatus)throw new Error(`HTTP ${response.status}, expected ${expectedStatus}`);
    const body=binary?Buffer.from(await response.arrayBuffer()):await response.json();
    const details=validate(body,response);
    report.checks.push({name,passed:true,...details});
  }catch(error){report.failures.push({name,error:error.message});}
}
await check('database identity','/api/database/health',body=>{
  if(!body.ok||body.database!=='zyz')throw new Error('Wrong or unavailable database');
  return {database:body.database};
});
await check('real map assets','/api/data/map-assets',body=>{
  if(body.energyAssets?.length!==9143||body.dataCenters?.length!==24)throw new Error('Asset counts differ');
  return {energyAssets:body.energyAssets.length,dataCenters:body.dataCenters.length};
});
await check('carbon coverage','/api/carbon-earth?request=manifest',body=>{
  const power=body.frames.filter(f=>f.sector==='Power');
  const total=body.frames.filter(f=>f.sector==='total');
  if(power.length!==2708||total.length!==31||body.latestDate!=='2026-05-31')throw new Error('Carbon coverage differs');
  return {powerDays:power.length,totalDays:total.length,latestDate:body.latestDate};
});
await check('carbon payload hash','/api/carbon-earth?request=frame&sector=Power&date=2026-05-31',(bytes,response)=>{
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==response.headers.get('x-carbon-sha256'))throw new Error('Returned payload hash differs');
  return {bytes:bytes.length,sha256:hash};
},200,true);
await check('quarantined data stays unavailable','/api/carbon-earth?request=frame&sector=InternationalAviation&date=2024-06-01',()=>({status:404}),404);
await check('VRE scenario manifest','/api/data/climate-vre?request=manifest',body=>{
  if(body.regions?.length!==32||body.years?.length!==40||body.scenario!=='ssp126')throw new Error('VRE manifest differs');
  return {regions:body.regions.length,years:body.years.length,scenario:body.scenario};
});
report.passed=report.failures.length===0;
await fs.writeFile(path.join(path.dirname(repo),'outputs/20260904-pg-migration/app-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
