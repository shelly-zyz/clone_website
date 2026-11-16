import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const regionalCatalog = source('public/data/weather-replay/regional-catalog.json');
const regions = moduleUrl(source('src/lib/weather-replay/regions.ts').replace(
  'import catalog from "../../../public/data/weather-replay/regional-catalog.json";',
  'const catalog = ' + regionalCatalog));
const geo = moduleUrl(source('src/app/visualization/weather-replay/replay-geography.ts'), { '@/lib/weather-replay/regions': regions, 'd3-geo': pathToFileURL(require.resolve('d3-geo')).href });
const { prepareReplayArea } = await import(geo);
const data = moduleUrl(source('src/app/visualization/weather-replay/replay-data.ts'));
const { accumulateRain, stackFrameIndices } = await import(data);
const palette = moduleUrl(source('src/app/visualization/weather-replay/replay-palette.ts'));
const { replayTexture, smoothAccumulation } = await import(palette);
const { paintReplay } = await import(moduleUrl(source('src/app/visualization/weather-replay/replay-canvas.ts'),
  { './replay-data': data, './replay-palette': palette }));
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

assert(archive.mapBounds.west < replay.bounds.west, 'the basemap extends landward');
assert.deepEqual(archive.bounds, replay.bounds, 'the data retain their geographic extent');

function recorder() {
  const surfaces = [];
  const fills = new Set();
  const rasters = [];
  const strokes = [];
  const labels = [];
  let path = [];
  const ctx = new Proxy({
    beginPath(){path=[];}, moveTo(...p){path.push(['M',...p]);}, lineTo(...p){path.push(['L',...p]);},
    closePath(){}, arc(){},
    fill(){
      fills.add(this.fillStyle);
      if (this.fillStyle?.startsWith('rgb(')) surfaces.push(this.fillStyle);
    },
    stroke(){ strokes.push(path); },
    fillText(label){ labels.push(label); },
    drawImage(image, ...placement){ rasters.push({ image, placement, alpha: this.globalAlpha }); },
  }, {get(target,key){return key in target ? target[key] : () => {}; }});
  ctx.fillStyle = '';
  return { surfaces, fills, rasters, strokes, labels, canvas:{clientWidth:1060,clientHeight:500,width:1060,height:500,getContext:()=>ctx} };
}

globalThis.window = {devicePixelRatio:1};
globalThis.document = {
  createElement() {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: image => { canvas.pixels = image.data; },
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
    });
    return canvas;
  },
};

const texture = replayTexture([null, 0, 5, 60], 2, 2, 75).pixels;
assert.equal(texture[3], 0, 'null is transparent');
assert.equal(texture[7], 0, 'no rain is transparent');
assert(texture[11] > 0 && texture[15] > texture[11], 'heat map encodes weak and intense rain');
assert.notDeepEqual([...texture.slice(8, 11)], [...texture.slice(12, 15)], 'palette encodes rain rate');

assert.deepEqual(smoothAccumulation([null, 0, 20, 40], 2, 2).slice(0, 2), [null, 0],
  'smoothing retains missing and dry cells');

const index = Math.min(8, replay.rain.length - 1);
const common = { index, area: archive, clouds:true, precipitation:true, previous:index, progress:1, rotation:.42 };
const overlay = recorder();
paintReplay(overlay.canvas, replay, { ...common, view: 'weather' });
assert(overlay.rasters.length > 3, 'rain and rounded cloud sprites contribute to the volume');
const stack = recorder();
paintReplay(stack.canvas, replay, { ...common, view: 'time' });
const frames = stackFrameIndices(replay, index);
assert.equal(stack.rasters.length, 0, 'time layers use solid faces');
const wetCells = frames.reduce((count, frame) =>
  count + replay.rain[frame].values.filter(value => value != null && value >= .2).length, 0);
assert.equal(stack.surfaces.length, 3 * wetCells, 'every visible wet cell draws three opaque faces');
assert(new Set(stack.surfaces).size > 3, 'the time layers retain varied rain intensity and face shading');
assert(stack.labels.includes('UTC'));
for (const frame of frames) assert(stack.labels.includes(replay.rain[frame].time.slice(11, 16)));
const accumulated = recorder(), mono = recorder();
const totals = accumulateRain(replay)[index];
paintReplay(accumulated.canvas, replay, { ...common, view:'accumulation', totals, accumulationLimit:150 });
paintReplay(mono.canvas, replay, { ...common, view:'accumulation', totals, accumulationLimit:150 });
assert(accumulated.surfaces.length > 0);
for (const recording of [overlay, stack, accumulated, renderRain(1, 0, 'rain')]) {
  assert(recording.fills.has('#142630'), 'each mode uses an opaque water surface');
  assert(recording.fills.has('#293d46'), 'each mode uses opaque land');
}
assert.deepEqual(accumulated.surfaces, mono.surfaces, 'a fixed scale yields stable colors for the same archived frame');
function renderRain(rate, phase, view, precipitation = true) {
  const recording = recorder();
  // Only one wet grid cell. Weak and strong rain share the same trajectories
  // for overlapping particles, with extra particles at the higher rate.
  const sample = tiny(-80, 23, -64, 35);
  sample.rain[0].values = [0, 0, rate, null];
  paintReplay(recording.canvas, sample, {
    area: archive, view, rotation: 0.42, index: 0, previous: 0, progress: 1,
    phase, clouds: false, precipitation,
  });
  return recording;
}

for (const view of ['weather', 'rain']) {
  const light = renderRain(1, 0, view);
  const heavy = renderRain(64, 0, view);
  assert(light.labels.some(label => label.endsWith('°W')) && light.labels.some(label => label.endsWith('°N')));
  assert(light.rasters.length >= 2, 'weak rain draws a footprint and a translucent shaft');
  assert(heavy.rasters[1].alpha > light.rasters[1].alpha, 'strong rain increases curtain density');
  assert.equal(heavy.rasters[1].placement[3], light.rasters[1].placement[3], 'rates do not invent measured heights');
  const next = renderRain(64, 0.05, view);
  assert(next.rasters[2].placement[1] > heavy.rasters[2].placement[1], 'mist moves toward the surface');
  assert.equal(renderRain(0, 0, view).rasters.length, 1, 'zero and missing cells produce no rain volume');
}
assert.equal(renderRain(64, 0, 'weather', false).rasters.length, 0, 'cloud view honors precipitation toggle');

const globalGeography = JSON.parse(source('public/data/natural-earth/ne_50m_admin_0_countries.geojson'));
const grids = new Set();
for (const item of JSON.parse(regionalCatalog)) {
  const sample = JSON.parse(source('public/data/weather-replay/' + item.archive + '.json'));
  const area = prepareReplayArea(sample, item.value, globalGeography);
  const { bounds, rows, cols, rain, satellite, metadata } = sample;
  assert.deepEqual(area.bounds, bounds);
  assert(area.hasData && area.mapPolygons.length > 0, item.value + ' has aligned geography and rain');
  assert(!grids.has(JSON.stringify(rain[2].values)), 'separate region rain matrices');
  grids.add(JSON.stringify(rain[2].values));
  assert.equal(metadata.cloudVariable, 'cover');
  for (const [i, frame] of rain.entries()) {
    assert.equal(frame.time, satellite[i].time);
    assert.equal(frame.values.length, rows * cols);
    assert(frame.values.some(value => value > .2));
  }
  const wet = rain[0].values.findIndex((amount, i) => amount != null && rain[1].values[i] != null);
  assert(Math.abs(accumulateRain(sample)[1][wet] - (rain[0].values[wet] + rain[1].values[wet]) * 1.5) < 1e-9);
}
console.log('PASS: geography, regional coverage, volume rendering, masks and integration');
