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
const { accumulateRain, accumulationStart, areaStats, cellAreas, contourSegments, maxContinuousAccumulation, stackFrameIndices, trackHotspots } = await import(data);
const palette = moduleUrl(source('src/app/visualization/weather-replay/replay-palette.ts'));
const { accumulationLevels, bandIndex, bandPalette, radarScale, replayLegend, scaleColor, scaleLookup, volumeScale } = await import(palette);
const field = moduleUrl(source('src/app/visualization/weather-replay/replay-field.ts'));
const { blurField, isolines, joinSegments, localMaxima, upsample } = await import(field);
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

// Continuous fields: interpolation never fills a missing observation.
const grid = upsample([0, 4, 8, 12, null, 4, 8, 12, 0, 4, 8, 12], 4, 3, 4);
assert.equal(grid.width, 13);
assert.equal(grid.height, 9);
assert.equal(grid.data[12], 12, 'source samples are preserved');
assert(Math.abs(grid.data[4 * 13 + 8] - 8) < 1e-6);
assert(Number.isNaN(grid.data[0]) && Number.isNaN(grid.data[4 * 13]), 'squares touching a missing cell stay missing');
assert(Number.isNaN(grid.data[1 * 13 + 1]), 'interpolation does not bridge a gap');
const smooth = upsample([0, 0, 0, 0, 9, 0, 0, 0, 0], 3, 3, 4);
assert(smooth.data.every(value => value >= 0), 'rates are clamped at zero after cubic overshoot');
assert(Math.abs(smooth.data[4 * 9 + 4] - 9) < 1e-6, 'peak sample is kept');
assert(blurField(grid, 1).data.some(Number.isNaN), 'blur keeps missing samples missing');
const ramp = { data: Float32Array.from([0, 1, 2, 0, 1, 2, 0, 1, 2]), width: 3, height: 3, factor: 1 };
const contour = isolines(ramp, 1.5);
assert.equal(contour.length, 2, 'one isoline segment per crossed square');
assert(contour.every(([x1, , x2]) => x1 === 1.5 && x2 === 1.5), 'isoline crosses at the interpolated level');
assert.equal(joinSegments(contour).length, 1, 'segments join into one polyline');
assert.equal(isolines({ ...ramp, data: Float32Array.from([0, 1, NaN, 0, 1, 2, 0, 1, 2]) }, 1.5).length, 1, 'isolines skip squares with missing corners');
const peakData = new Float32Array(49);
peakData[1 * 7 + 1] = 5;
peakData[5 * 7 + 5] = 7;
const peaks = localMaxima({ data: peakData, width: 7, height: 7, factor: 1 }, 1, 2);
assert.deepEqual(peaks.map(peak => peak.value), [7, 5], 'separate rain maxima are found strongest first');

// Colour scales and legends.
const levels = accumulationLevels(390);
assert.equal(levels[0], 1);
assert(levels.at(-1) >= 390, 'the top band covers the case maximum');
assert.equal(bandPalette(levels).length, levels.length);
assert.equal(bandIndex(levels, .5), -1, 'totals below the first isohyet stay unfilled');
assert.equal(bandIndex(levels, 30), levels.findLastIndex(level => level <= 30));
assert(accumulationLevels(12).length >= 8, 'small totals still get enough bands');
assert.deepEqual(scaleColor(radarScale, 0), radarScale[0][1]);
assert.deepEqual([...scaleLookup(volumeScale).slice(-4)], [...volumeScale.at(-1)[1], 255]);
for (const view of ['weather', 'time', 'rain', 'accumulation']) {
  const legend = replayLegend(view, 105, 390);
  assert(legend.colors.length >= 6, view + ' legend has a full scale');
}
assert.equal(replayLegend('accumulation', 105, 390).kind, 'classes', 'isohyets use discrete classes');
assert.equal(replayLegend('weather', 105, 390).kind, 'ramp');
assert.notDeepEqual(replayLegend('weather', 105, 390).colors, replayLegend('time', 105, 390).colors, 'views use distinct palettes');
const frames = stackFrameIndices(replay, Math.min(8, replay.rain.length - 1));
assert(frames.includes(Math.min(8, replay.rain.length - 1)) && frames.length <= 5, 'the selected instant always has a slice');

// Baked relief and place labels cover every regional case.
const relief = JSON.parse(source('public/data/weather-replay/relief/manifest.json'));
for (const item of [...JSON.parse(regionalCatalog).map(({ bounds }) => bounds), fixture.bounds]) {
  assert(relief.items.some(({ bounds }) => bounds.west <= item.west && bounds.east >= item.east && bounds.south <= item.south && bounds.north >= item.north),
    'relief raster covers the replay bounds');
}
assert(JSON.parse(source('public/data/weather-replay/places.json')).places.length > 100);

const series = {
  ...tiny(110, 20, 110.2, 20.2), metadata: {stepMinutes: 180},
  rain: [
    ['2026-09-26T00:00:00Z', [null, 0, 5, 0]],
    ['2026-09-26T03:00:00Z', [0, 0, 5, 5]],
    ['2026-09-26T06:00:00Z', [0, 0, 0, 5]],
    ['2026-09-26T12:00:00Z', [0, 0, 0, 5]],
    ['2026-09-26T15:00:00Z', [0, 0, 0, 5]],
  ].map(([time, values]) => ({ time, values })),
};
const weights = cellAreas(series);
const {frames: hotspots, tracks} = trackHotspots(series, weights, 2.5);
assert.deepEqual(tracks.get(hotspots[0][0].id).map(spot => spot.frame), [0, 1, 2],
  'overlapping consecutive storm cells are linked');
assert.notEqual(hotspots[2][0].id, hotspots[3][0].id, 'a timestamp gap breaks tracking');
assert.equal(accumulationStart(series, 2, 6), 0);
assert.equal(accumulationStart(series, 3, 6), undefined, 'a nominal six-hour window with a gap has no total');
assert.equal(accumulateRain(series)[2][0], null, 'missing cells are carried through only for the selected window');
assert.equal(accumulateRain(series, 1)[1][0], 0);
assert.equal(accumulateRain(series, 3)[1][3], 15, 'accumulation can start again after a gap');
assert.equal(maxContinuousAccumulation(series), 22.5);
assert(weights[0] > weights[3], 'grid cell area decreases with latitude');
assert.equal(areaStats([null, 0, 0, 3], weights, [1]).above[0], weights[3]);
assert.equal(contourSegments([0, 2, 0, 2], 2, 2, 1).length, 1);
assert.equal(contourSegments([null, 2, 0, 2], 2, 2, 1).length, 0, 'contours never bridge missing cells');

const globalGeography = JSON.parse(source('public/data/natural-earth/ne_50m_admin_0_countries.geojson'));
const grids = new Set();
for (const item of JSON.parse(regionalCatalog)) {
  const sample = JSON.parse(source('public/data/weather-replay/' + item.archive + '.json'));
  const area = prepareReplayArea(sample, item.value, globalGeography);
  const { bounds, rows, cols, rain, satellite, metadata } = sample;
  assert.deepEqual(area.bounds, bounds);
  assert.deepEqual(item.bounds, bounds, "globe and archive use identical coverage");
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
console.log('PASS: geography, regional coverage, continuous fields, palettes, tracking, contours, and integration');
