#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceRoot = path.join(
  repoRoot,
  "output",
  "course_carbon_power_prediction_lite_v1_20260730",
);
const outputRoot = path.join(
  repoRoot,
  "output",
  "course_carbon_power_prediction_lite_v2_corrected_20260730",
);
await mkdir(outputRoot, { recursive: true });

const progressPath = path.join(outputRoot, "EXPORT_PROGRESS.json");
const files = [];

await transformCsv(
  "01_carbon_all_sectors_daily_global_2019_2026.csv",
  (cells) => {
    cells[0] = addOneDay(cells[0]);
    return cells;
  },
  10,
);
await transformCsv(
  "02_climate_daily_summary_china_2021_2026.csv",
  (cells) => {
    cells[0] = addOneDay(cells[0]);
    return cells;
  },
  20,
);
await transformCsv(
  "03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv",
  (cells) => {
    cells[0] = addOneDay(cells[0]);
    const sourceTasC = Number(cells[6]);
    cells[6] = numberText(sourceTasC + 273.15, 6);
    cells[7] = numberText(sourceTasC, 6);
    return cells;
  },
  75,
);
await transformCsv(
  "04_china_daily_power_carbon_climate_summary_2021_2026.csv",
  (cells) => {
    cells[0] = addOneDay(cells[0]);
    const sourceTasC = Number(cells[3]);
    cells[3] = numberText(sourceTasC + 273.15, 6);
    cells[4] = numberText(sourceTasC, 6);
    return cells;
  },
  82,
);

for (const name of [
  "05_renewable_resource_potential_china_0p5deg.csv",
  "06_vre_annual_capacity_factor_summary_china_2021_2060.csv",
  "07_source_catalog_and_provenance.csv",
]) {
  await copyFile(path.join(sourceRoot, name), path.join(outputRoot, name));
  await recordFile(name, null);
}

const dictionaryName = "08_data_dictionary.csv";
let dictionary = await readFile(path.join(sourceRoot, dictionaryName), "utf8");
dictionary = dictionary
  .replace(
    "24小时平均地表气温",
    "由源数据摄氏温度加273.15换算",
  )
  .replace(
    "由K减273.15换算",
    "24小时平均地表气温；源变量单位为degree_Celsius",
  );
await writeFile(path.join(outputRoot, dictionaryName), dictionary, "utf8");
await recordFile(dictionaryName, null);

const readmeName = "README_简易版数据说明.md";
await copyFile(path.join(sourceRoot, readmeName), path.join(outputRoot, readmeName));
await recordFile(readmeName, null);

const deprecatedNotice = `该目录是首次导出版本，抽样校验发现日期受时区影响提前一天，且tas源单位被误判为K。
请不要使用本目录中的CSV进行分析。
正确版本位于：
${outputRoot}
`;
await writeFile(
  path.join(sourceRoot, "DO_NOT_USE_请使用v2修正版.txt"),
  deprecatedNotice,
  "utf8",
);

const sourceManifest = JSON.parse(
  await readFile(path.join(sourceRoot, "MANIFEST.json"), "utf8"),
);
const rowMap = new Map(
  sourceManifest.files.map((item) => [item.fileName, item.rows]),
);
for (const file of files) {
  file.rows = rowMap.get(file.fileName) ?? file.rows;
}
const manifest = {
  packageName: "carbon_power_prediction_lite_v2_corrected",
  generatedAt: new Date().toISOString(),
  correctionNote:
    "Corrected PostgreSQL date timezone rendering and tas source unit (degree_Celsius).",
  databaseSchema: "website_data",
  carbonPeriod: { start: "2019-01-01", end: "2026-04-30" },
  modelPeriod: { start: "2021-01-01", end: "2026-04-30" },
  files,
};
await writeFile(
  path.join(outputRoot, "MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
await updateProgress({
  status: "completed",
  percent: 100,
  stage: "done",
  outputRoot,
  files,
});
console.log(`FIX_COMPLETE ${outputRoot}`);

async function transformCsv(fileName, transform, percent) {
  const sourcePath = path.join(sourceRoot, fileName);
  const outputPath = path.join(outputRoot, fileName);
  const input = createReadStream(sourcePath, { encoding: "utf8" });
  const output = createWriteStream(outputPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let row = 0;
  for await (const line of lines) {
    if (row === 0) {
      await writeChunk(output, `${line}\n`);
    } else {
      const cells = line.split(",");
      await writeChunk(output, `${transform(cells).join(",")}\n`);
    }
    row += 1;
    if (row % 500_000 === 0) {
      console.log(`FIX_PROGRESS ${fileName} ${row - 1} rows`);
    }
  }
  output.end();
  await once(output, "finish");
  await recordFile(fileName, row - 1);
  await updateProgress({
    status: "running",
    percent,
    stage: fileName,
    completedRows: row - 1,
  });
}

function addOneDay(text) {
  const date = new Date(`${text}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function numberText(value, digits = 6) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

async function recordFile(fileName, rows) {
  const filePath = path.join(outputRoot, fileName);
  const info = await stat(filePath);
  files.push({
    fileName,
    rows,
    sizeBytes: info.size,
    sha256: await sha256File(filePath),
  });
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

async function writeChunk(stream, text) {
  if (!stream.write(text)) {
    await once(stream, "drain");
  }
}

async function updateProgress(payload) {
  const existing = await readFile(progressPath, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => ({}));
  await writeFile(
    progressPath,
    `${JSON.stringify(
      { ...existing, ...payload, updatedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
