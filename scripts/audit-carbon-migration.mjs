import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.dirname(repo);
const output=path.join(workspace,'outputs/20260904-pg-migration/carbon-source-audit.json');
const hash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
const roots=['carbon-graced/processed/Power','carbon-graced-minscratch/scratch/_current',
  'carbon-graced-restore-scratch/scratch/_current','carbon-graced-scratch/scratch/Power','carbon-graced-scratch/scratch/total'];
const manifests=[];
async function walk(root){for(const e of await fs.readdir(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isDirectory())await walk(p);else if(e.name==='manifest.json')manifests.push(p);}}
for(const root of roots)await walk(path.join(workspace,'data',root));
const records=[];
for(const file of manifests.sort()){
  const m=JSON.parse(await fs.readFile(file,'utf8'));
  const entry={manifest:path.relative(workspace,file).replaceAll('\\','/'),sector:m.sector,month:m.month,frames:m.frames.length,badFrames:[],archive:null};
  for(const f of m.frames){const p=path.resolve(workspace,f.path);const rel=path.relative(workspace,p);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Frame outside workspace');
    try{const s=await fs.stat(p);const actual=await hash(p);if(s.size!==f.sizeBytes||actual!==f.sha256)entry.badFrames.push({date:f.date,path:f.path,expectedBytes:f.sizeBytes,actualBytes:s.size,expectedHash:f.sha256,actualHash:actual});}
    catch(e){entry.badFrames.push({date:f.date,path:f.path,error:e.code??e.message});}}
  try{const p=path.resolve(workspace,m.source.localArchivePath);const rel=path.relative(workspace,p);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Archive outside workspace');
    const actual=await hash(p);entry.archive={path:m.source.localArchivePath,expectedHash:m.source.archiveSha256,actualHash:actual,matches:actual===m.source.archiveSha256};}
  catch(e){entry.archive={error:e.code??e.message,matches:false};}
  records.push(entry);
}
await fs.writeFile(output,JSON.stringify({checkedAt:new Date().toISOString(),records},null,2));
console.log(JSON.stringify({manifests:records.length,frames:records.reduce((n,r)=>n+r.frames,0),bad:records.filter(r=>r.badFrames.length||!r.archive.matches).map(r=>({manifest:r.manifest,frames:r.frames,badFrames:r.badFrames.length,archive:r.archive})),output},null,2));
