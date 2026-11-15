import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);

const root = new URL('../', import.meta.url);
const source = path => readFileSync(new URL(path, root), 'utf8');
const moduleUrl = (text, imports = {}) => {
  let code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll('"' + name + '"', '"' + url + '"');
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
};
const regions = moduleUrl(source('src/lib/weather-replay/regions.ts'));
const geo = moduleUrl(source('src/app/visualization/weather-replay/replay-geography.ts'), { '@/lib/weather-replay/regions': regions, 'd3-geo': pathToFileURL(require.resolve('d3-geo')).href });
const { prepareReplayArea } = await import(geo);
const data = moduleUrl(source('src/app/visualization/weather-replay/replay-data.ts'));
const { accumulateRain } = await import(data);
const { paintReplay } = await import(moduleUrl(source('src/app/visualization/weather-replay/replay-canvas.ts'), { './replay-data': data }));
const original = execFileSync('git', ['show', '6d506a6^:src/app/visualization/weather-replay/replay-canvas.ts'], { encoding: 'utf8' });
const { paintReplay: paintOriginal } = await import(moduleUrl(original));
const geography = JSON.parse(source('public/data/weather-replay/regions.geojson'));
const fixture = {
  bounds: { west: -80, east: -64, south: 23, north: 35 }, cols: 81, rows: 61, coastline: [],
  rain: Array.from({ length: 9 }, (_, i) => ({ time: new Date(Date.UTC(2026, 8, 26, 9, i * 15)).toISOString(), values: Array.from({ length: 81 * 61 }, (_, j) => j % 13 ? (j % 75) : null) })),
  satellite: [{ time: '2026-09-26T09:00:00.000Z', values: Array(81 * 61).fill(230) }],
};
// Include an IR frame within the valid hourly interval at the selected time.
fixture.satellite.push({ ...fixture.satellite[0], time: fixture.rain[8].time });
const replay = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : fixture;
const archive = prepareReplayArea(replay, 'archive', geography);
for (const polygon of archive.polygons) for (const ring of polygon) for (const [lon,lat] of ring) {
  assert(lon>=replay.bounds.west && lon<=replay.bounds.east && lat>=replay.bounds.south && lat<=replay.bounds.north, 'clip land before perspective to prevent inverted offscreen polygons');
}
for (const id of ['usa', 'bahamas']) {
  const area = prepareReplayArea(replay, id, geography);
  assert.equal(area.ocean, true, id + ' retains offshore support');
  assert.deepEqual(area.cells, archive.cells, id + ' cannot discard offshore observations');
  assert.deepEqual(area.bounds, replay.bounds, id + ' cannot rescale data');
}
const china = prepareReplayArea(replay, 'china', geography);
assert.equal(china.hasData, false);
assert.equal(china.ocean, false);
assert(china.bounds.west < 75 && china.bounds.east > 130);
assert(china.polygons.length > 1, 'mainland and islands retained');
// A hole and a separate island inside it exercise Polygon/MultiPolygon ownership.
const ring = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d],[a,b]];
const custom = {type:'FeatureCollection', features:[{id:'USA', geometry:{type:'MultiPolygon', coordinates:[[ring(0,0,10,10),ring(2,2,8,8)],[ring(4,4,6,6)]]}}]};
const tiny = (west,south,east,north) => ({...fixture, bounds:{west,south,east,north}, cols:2, rows:2, rain:[{time:fixture.rain[0].time,values:[1,1,1,1]}],satellite:[]});
assert.equal(prepareReplayArea(tiny(3,3,3.5,3.5),'usa',custom).hasData,false,'hole stays empty');
const island = prepareReplayArea(tiny(4.5,4.5,5.5,5.5),'usa',custom);
assert.equal(island.hasData,true,'island inside a hole is preserved');
assert.equal(island.polygons.length, 1, 'clipping retains the island, not the enclosing hole');
assert.equal(prepareReplayArea(tiny(0.5,0.5,1,1),'usa',custom).ocean,false,'inland data uses national outline');

// Compare data drawing operations against history, excluding only geographic support.
// This catches changes to density, height, color, spacing, camera and distribution.
function recorder() {
  const operations = []; let path = [];
  const ctx = new Proxy({
    beginPath(){path=[];}, moveTo(...p){path.push(['M',...p]);}, lineTo(...p){path.push(['L',...p]);},
    closePath(){}, ellipse(...p){path.push(['E',...p]);},
    fill(){ if (/^(rgba\(224, 117, 52|rgba\(39, 105, 163|hsl\()/.test(this.fillStyle)) operations.push([this.fillStyle,structuredClone(path)]); },
    stroke(){if (/^(rgba\(129,181|rgba\(150,208|rgba\(216,241|rgba\(136,213)/.test(this.strokeStyle)) operations.push([this.strokeStyle,this.lineWidth,structuredClone(path)]);},
  }, {get(target,key){return key in target ? target[key] : () => {};}});
  return { operations, canvas:{clientWidth:1060,clientHeight:500,width:1060,height:500,getContext:()=>ctx} };
}
globalThis.window = {devicePixelRatio:1};
for (const view of ['weather','time','rain','accumulation']) {
  const current=recorder(), before=recorder();
  const index=Math.min(8,replay.rain.length-1);
  const args={index,view,clouds:true,precipitation:true,previous:index,progress:1,phase:0.375,totals:accumulateRain(replay)[index]};
  paintReplay(current.canvas,replay,{...args,area:archive,rotation:0.42});
  paintOriginal(before.canvas,replay,{...args,rotation:0});
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(digest(current.operations),digest(before.operations),view+' matches historical data rendering');
  assert(current.operations.length>0,view+' renders data');
  console.log(view+': historical data drawing preserved ('+current.operations.length+' operations)');
}
console.log('PASS: coastal data, national outline, holes, islands, coordinates and four-mode rendering');
