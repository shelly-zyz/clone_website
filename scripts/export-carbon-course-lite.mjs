#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outputRoot = path.resolve(
  repoRoot,
  "output",
  "course_carbon_power_prediction_lite_v1_20260730",
);
const progressPath = path.join(outputRoot, "EXPORT_PROGRESS.json");

const carbonStart = "2019-01-01";
const modelStart = "2021-01-01";
const endInclusive = "2026-04-30";
const endExclusive = "2026-05-01";
const climateVariables = ["tas", "sfcwind", "rsds", "huss", "ps"];

await loadLocalEnvironment();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

await mkdir(outputRoot, { recursive: true });

const client = new pg.Client({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
  connectionTimeoutMillis: 30_000,
  query_timeout: 600_000,
  statement_timeout: 600_000,
  keepAlive: true,
});

const generatedFiles = [];
const startedAt = new Date();

try {
  await client.connect();
  await updateProgress({
    status: "running",
    stage: "connected",
    percent: 1,
    startedAt: startedAt.toISOString(),
  });

  const grid = await loadClimateGrid();
  await exportGlobalSectorDaily();
  await exportClimateDailySummary();
  await exportChinaGridModelTable(grid);
  await exportRenewablePotential();
  await exportVreAnnualSummary();
  await exportSourceCatalog();
  await exportDataDictionary();
  await exportReadme(grid);
  await exportManifest();

  await updateProgress({
    status: "completed",
    stage: "done",
    percent: 100,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    outputRoot,
    files: generatedFiles,
  });
  console.log(`EXPORT_COMPLETE ${outputRoot}`);
} finally {
  await client.end().catch(() => {});
}

async function loadClimateGrid() {
  const result = await client.query(`
    SELECT id, point_count, spatial_resolution_deg,
           longitude_min, longitude_max, latitude_min, latitude_max,
           coordinate_data
    FROM website_data.climate_projection_grids
    WHERE point_count = 3848
    ORDER BY id
    LIMIT 1
  `);
  if (result.rows.length !== 1) {
    throw new Error("Expected one 3,848-point climate grid.");
  }
  const row = result.rows[0];
  const decoded = gunzipSync(row.coordinate_data);
  const coordinates = new Float32Array(
    decoded.buffer,
    decoded.byteOffset,
    decoded.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  if (coordinates.length !== Number(row.point_count) * 2) {
    throw new Error("Climate coordinate buffer has an unexpected size.");
  }
  const longitude = new Float32Array(Number(row.point_count));
  const latitude = new Float32Array(Number(row.point_count));
  for (let index = 0; index < Number(row.point_count); index += 1) {
    longitude[index] = coordinates[index * 2];
    latitude[index] = coordinates[index * 2 + 1];
  }
  return {
    id: Number(row.id),
    pointCount: Number(row.point_count),
    resolution: Number(row.spatial_resolution_deg),
    longitudeMin: Number(row.longitude_min),
    longitudeMax: Number(row.longitude_max),
    latitudeMin: Number(row.latitude_min),
    latitudeMax: Number(row.latitude_max),
    longitude,
    latitude,
  };
}

async function exportGlobalSectorDaily() {
  const fileName = "01_carbon_all_sectors_daily_global_2019_2026.csv";
  const filePath = path.join(outputRoot, fileName);
  const result = await client.query(
    `
      SELECT observed_on, sector, unit, min_value, max_value, mean_value,
             sum_kgc_per_hour, nonzero_count, source_archive_id,
             frame_sha256
      FROM website_data.carbon_emission_frames
      WHERE observed_on >= $1 AND observed_on < $2
      ORDER BY observed_on, sector
    `,
    [carbonStart, endExclusive],
  );
  const rows = [
    [
      "date",
      "sector",
      "source_unit",
      "grid_min_kgc_per_hour",
      "grid_max_kgc_per_hour",
      "grid_mean_kgc_per_hour",
      "global_sum_kgc_per_hour",
      "global_tco2_per_day",
      "nonzero_grid_count",
      "source_archive_id",
      "frame_sha256",
    ].join(","),
  ];
  for (const row of result.rows) {
    const kgcPerHour = Number(row.sum_kgc_per_hour);
    rows.push(
      [
        dateString(row.observed_on),
        row.sector,
        row.unit,
        numberText(row.min_value),
        numberText(row.max_value),
        numberText(row.mean_value),
        numberText(kgcPerHour),
        numberText((kgcPerHour * 24 * 44) / 12 / 1_000),
        row.nonzero_count,
        row.source_archive_id,
        row.frame_sha256,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await writeFile(filePath, `${rows.join("\n")}\n`, "utf8");
  await recordFile(fileName, result.rows.length);
  await updateProgress({ status: "running", stage: fileName, percent: 4 });
}

async function exportClimateDailySummary() {
  const fileName = "02_climate_daily_summary_china_2021_2026.csv";
  const filePath = path.join(outputRoot, fileName);
  const result = await client.query(
    `
      SELECT valid_date, variable, unit, point_count, min_value, max_value,
             mean_value, missing_count, source_id, frame_sha256
      FROM website_data.climate_projection_daily
      WHERE valid_date >= $1 AND valid_date < $2
      ORDER BY valid_date, variable
    `,
    [modelStart, endExclusive],
  );
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  await writeChunk(
    stream,
    "date,variable,unit,point_count,hourly_spatial_min,hourly_spatial_max,hourly_spatial_mean,missing_count,source_id,frame_sha256\n",
  );
  for (const row of result.rows) {
    await writeChunk(
      stream,
      [
        dateString(row.valid_date),
        row.variable,
        row.unit,
        row.point_count,
        numberText(row.min_value),
        numberText(row.max_value),
        numberText(row.mean_value),
        row.missing_count,
        row.source_id,
        row.frame_sha256,
      ]
        .map(csvCell)
        .join(",") + "\n",
    );
  }
  stream.end();
  await once(stream, "finish");
  await recordFile(fileName, result.rows.length);
  await updateProgress({ status: "running", stage: fileName, percent: 7 });
}

async function exportChinaGridModelTable(grid) {
  const fileName =
    "03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv";
  const filePath = path.join(outputRoot, fileName);
  const dailyFileName =
    "04_china_daily_power_carbon_climate_summary_2021_2026.csv";
  const dailyFilePath = path.join(outputRoot, dailyFileName);
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  const dailyStream = createWriteStream(dailyFilePath, { encoding: "utf8" });
  await writeChunk(
    stream,
    [
      "date",
      "grid_point_id",
      "longitude_deg",
      "latitude_deg",
      "power_sum_kgc_per_hour",
      "power_tco2_per_day",
      "tas_k_daily_mean",
      "tas_c_daily_mean",
      "sfcwind_m_per_s_daily_mean",
      "rsds_w_per_m2_daily_mean",
      "huss_kg_per_kg_daily_mean",
      "ps_pa_daily_mean",
      "ps_hpa_daily_mean",
      "power_nonzero_flag",
    ].join(",") + "\n",
  );
  await writeChunk(
    dailyStream,
    [
      "date",
      "china_grid_power_sum_kgc_per_hour",
      "china_grid_power_tco2_per_day",
      "tas_k_spatial_mean",
      "tas_c_spatial_mean",
      "sfcwind_m_per_s_spatial_mean",
      "rsds_w_per_m2_spatial_mean",
      "huss_kg_per_kg_spatial_mean",
      "ps_pa_spatial_mean",
      "ps_hpa_spatial_mean",
      "nonzero_0p5deg_grid_count",
      "grid_point_count",
    ].join(",") + "\n",
  );

  const months = monthWindows(modelStart, endExclusive);
  const totalDays = daysBetween(modelStart, endExclusive);
  let completedDays = 0;
  let outputRows = 0;

  for (const [monthStart, monthEnd] of months) {
    const [climateResult, carbonResult] = await Promise.all([
      client.query(
        `
          SELECT valid_date, variable, unit, point_count, frame_data
          FROM website_data.climate_projection_daily
          WHERE valid_date >= $1 AND valid_date < $2
            AND variable = ANY($3::text[])
          ORDER BY valid_date, variable
        `,
        [monthStart, monthEnd, climateVariables],
      ),
      client.query(
        `
          SELECT observed_on, width, height, longitude_min, latitude_max,
                 dx, dy, frame_data
          FROM website_data.carbon_emission_frames
          WHERE sector='Power' AND observed_on >= $1 AND observed_on < $2
          ORDER BY observed_on
        `,
        [monthStart, monthEnd],
      ),
    ]);

    const climateByDay = new Map();
    for (const row of climateResult.rows) {
      const day = dateString(row.valid_date);
      if (!climateByDay.has(day)) {
        climateByDay.set(day, new Map());
      }
      climateByDay.get(day).set(row.variable, row);
    }
    const carbonByDay = new Map(
      carbonResult.rows.map((row) => [dateString(row.observed_on), row]),
    );

    for (const [day, variableRows] of climateByDay) {
      if (variableRows.size !== climateVariables.length) {
        throw new Error(`Missing climate variable on ${day}.`);
      }
      const carbonRow = carbonByDay.get(day);
      if (!carbonRow) {
        throw new Error(`Missing Power carbon frame on ${day}.`);
      }

      const climateMeans = Object.fromEntries(
        climateVariables.map((variable) => {
          const row = variableRows.get(variable);
          return [
            variable,
            hourlyPointMeans(row.frame_data, Number(row.point_count)),
          ];
        }),
      );
      const carbonValues = float32FromGzip(carbonRow.frame_data);
      const power = aggregateCarbonAtClimatePoints(
        carbonValues,
        carbonRow,
        grid,
      );

      const lines = new Array(grid.pointCount);
      const spatialSums = Object.fromEntries(
        climateVariables.map((variable) => [variable, 0]),
      );
      let powerSum = 0;
      let nonzero = 0;
      for (let index = 0; index < grid.pointCount; index += 1) {
        const powerKgcPerHour = power[index];
        powerSum += powerKgcPerHour;
        if (powerKgcPerHour > 0) {
          nonzero += 1;
        }
        for (const variable of climateVariables) {
          const value = climateMeans[variable][index];
          if (Number.isFinite(value)) {
            spatialSums[variable] += value;
          }
        }
        const tasC = climateMeans.tas[index];
        const psPa = climateMeans.ps[index];
        lines[index] = [
          day,
          index + 1,
          numberText(grid.longitude[index], 2),
          numberText(grid.latitude[index], 2),
          numberText(powerKgcPerHour, 6),
          numberText((powerKgcPerHour * 24 * 44) / 12 / 1_000, 6),
          numberText(tasC + 273.15, 6),
          numberText(tasC, 6),
          numberText(climateMeans.sfcwind[index], 6),
          numberText(climateMeans.rsds[index], 6),
          numberText(climateMeans.huss[index], 9),
          numberText(psPa, 4),
          numberText(psPa / 100, 6),
          powerKgcPerHour > 0 ? 1 : 0,
        ].join(",");
      }
      await writeChunk(stream, `${lines.join("\n")}\n`);
      const divisor = grid.pointCount;
      await writeChunk(
        dailyStream,
        [
          day,
          numberText(powerSum, 6),
          numberText((powerSum * 24 * 44) / 12 / 1_000, 6),
          numberText(spatialSums.tas / divisor + 273.15, 6),
          numberText(spatialSums.tas / divisor, 6),
          numberText(spatialSums.sfcwind / divisor, 6),
          numberText(spatialSums.rsds / divisor, 6),
          numberText(spatialSums.huss / divisor, 9),
          numberText(spatialSums.ps / divisor, 4),
          numberText(spatialSums.ps / divisor / 100, 6),
          nonzero,
          grid.pointCount,
        ].join(",") + "\n",
      );
      completedDays += 1;
      outputRows += grid.pointCount;
    }

    const percent = 7 + Math.floor((completedDays / totalDays) * 78);
    await updateProgress({
      status: "running",
      stage: fileName,
      percent,
      completedDays,
      totalDays,
      outputRows,
      currentMonth: monthStart.slice(0, 7),
    });
    console.log(
      `MODEL_EXPORT ${completedDays}/${totalDays} days, ${outputRows} rows`,
    );
  }

  stream.end();
  dailyStream.end();
  await Promise.all([once(stream, "finish"), once(dailyStream, "finish")]);
  await recordFile(fileName, outputRows);
  await recordFile(dailyFileName, completedDays);
}

async function exportRenewablePotential() {
  const fileName = "05_renewable_resource_potential_china_0p5deg.csv";
  const filePath = path.join(outputRoot, fileName);
  const result = await client.query(`
    SELECT source_key, technology, longitude, latitude, region, grid,
           source_year, source_resolution_deg, project_resolution_deg,
           annual_capacity_factor, capacity_potential_gw,
           max_capacity_factor, source_cell_count, assumptions::text
    FROM website_data.renewable_resource_potential
    ORDER BY technology, region, latitude, longitude
  `);
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  await writeChunk(
    stream,
    "source_key,technology,longitude_deg,latitude_deg,region,grid,source_year,source_resolution_deg,project_resolution_deg,annual_capacity_factor,capacity_potential_gw,max_capacity_factor,source_cell_count,assumptions_json\n",
  );
  for (let start = 0; start < result.rows.length; start += 5_000) {
    const lines = result.rows.slice(start, start + 5_000).map((row) =>
      [
        row.source_key,
        row.technology,
        numberText(row.longitude, 6),
        numberText(row.latitude, 6),
        row.region,
        row.grid,
        row.source_year,
        numberText(row.source_resolution_deg, 6),
        numberText(row.project_resolution_deg, 6),
        numberText(row.annual_capacity_factor, 8),
        numberText(row.capacity_potential_gw, 8),
        numberText(row.max_capacity_factor, 8),
        row.source_cell_count,
        row.assumptions,
      ]
        .map(csvCell)
        .join(","),
    );
    await writeChunk(stream, `${lines.join("\n")}\n`);
  }
  stream.end();
  await once(stream, "finish");
  await recordFile(fileName, result.rows.length);
  await updateProgress({ status: "running", stage: fileName, percent: 89 });
}

async function exportVreAnnualSummary() {
  const fileName = "06_vre_annual_capacity_factor_summary_china_2021_2060.csv";
  const filePath = path.join(outputRoot, fileName);
  const result = await client.query(`
    SELECT region_id, region_label, year, technology, capacity_mw, hours,
           stats->>'mean' AS mean_capacity_factor,
           stats->>'annualGenerationGwh' AS annual_generation_gwh,
           stats#>>'{peak,value}' AS peak_capacity_factor,
           stats#>>'{peak,hourOfYear}' AS peak_hour_of_year,
           stats#>>'{low,value}' AS low_capacity_factor,
           stats#>>'{low,hourOfYear}' AS low_hour_of_year,
           metadata->>'gcm' AS gcm,
           metadata->>'scenario' AS scenario,
           metadata->>'capacityBasis' AS capacity_basis
    FROM website_data.climate_vre_hourly
    ORDER BY region_id, year, technology
  `);
  const header = [
    "region_id",
    "region_label",
    "year",
    "technology",
    "capacity_mw",
    "hours",
    "mean_capacity_factor",
    "annual_generation_gwh",
    "peak_capacity_factor",
    "peak_hour_of_year",
    "low_capacity_factor",
    "low_hour_of_year",
    "gcm",
    "scenario",
    "capacity_basis",
  ];
  const lines = [header.join(",")];
  for (const row of result.rows) {
    lines.push(header.map((key) => csvCell(row[key])).join(","));
  }
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  await recordFile(fileName, result.rows.length);
  await updateProgress({ status: "running", stage: fileName, percent: 91 });
}

async function exportSourceCatalog() {
  const fileName = "07_source_catalog_and_provenance.csv";
  const filePath = path.join(outputRoot, fileName);
  const [carbonResult, climateResult] = await Promise.all([
    client.query(`
      SELECT 'carbon' AS data_group, sector AS variable_or_sector,
             data_month::text AS period_start,
             (data_month + interval '1 month - 1 day')::date::text AS period_end,
             file_name, source_url, archive_sha256 AS checksum,
             source_attributes::text AS metadata_json
      FROM website_data.carbon_source_archives
      WHERE data_month >= '2019-01-01' AND data_month < '2026-05-01'
      ORDER BY sector, data_month
    `),
    client.query(`
      SELECT 'climate_projection' AS data_group,
             variable AS variable_or_sector, period_start::text, period_end::text,
             file_name, source_url, md5 AS checksum,
             source_attributes::text AS metadata_json
      FROM website_data.climate_projection_sources
      ORDER BY variable, period_start
    `),
  ]);
  const header = [
    "data_group",
    "variable_or_sector",
    "period_start",
    "period_end",
    "file_name",
    "source_url",
    "checksum",
    "metadata_json",
  ];
  const rows = [...carbonResult.rows, ...climateResult.rows];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => csvCell(row[key])).join(","));
  }
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  await recordFile(fileName, rows.length);
  await updateProgress({ status: "running", stage: fileName, percent: 93 });
}

async function exportDataDictionary() {
  const fileName = "08_data_dictionary.csv";
  const filePath = path.join(outputRoot, fileName);
  const dictionary = [
    ["table_file", "field", "type", "unit", "description"],
    ["01_carbon_all_sectors_daily_global_2019_2026.csv", "date", "date", "YYYY-MM-DD", "观测日期"],
    ["01_carbon_all_sectors_daily_global_2019_2026.csv", "sector", "text", "", "碳排放部门；Power为电力部门，total为总排放"],
    ["01_carbon_all_sectors_daily_global_2019_2026.csv", "global_sum_kgc_per_hour", "float", "kgC/h", "源栅格全球求和"],
    ["01_carbon_all_sectors_daily_global_2019_2026.csv", "global_tco2_per_day", "float", "tCO2/day", "按kgC/h×24×44/12÷1000换算"],
    ["02_climate_daily_summary_china_2021_2026.csv", "hourly_spatial_mean", "float", "源变量单位", "24小时×3848个中国0.5°点的总体平均"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "date", "date", "YYYY-MM-DD", "模型观测日期"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "grid_point_id", "integer", "", "固定的0.5°中国陆地点编号"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "longitude_deg", "float", "degree_east", "网格中心经度"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "latitude_deg", "float", "degree_north", "网格中心纬度"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "power_sum_kgc_per_hour", "float", "kgC/h", "以0.5°中心周围5×5个0.1°Power网格求和"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "power_tco2_per_day", "float", "tCO2/day", "0.5°电力部门日排放预测目标"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "tas_k_daily_mean", "float", "K", "由源数据摄氏温度加273.15换算"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "tas_c_daily_mean", "float", "°C", "24小时平均地表气温；源变量单位为degree_Celsius"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "sfcwind_m_per_s_daily_mean", "float", "m/s", "24小时平均近地面风速"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "rsds_w_per_m2_daily_mean", "float", "W/m²", "24小时平均地表向下短波辐射"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "huss_kg_per_kg_daily_mean", "float", "kg/kg", "24小时平均比湿"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "ps_pa_daily_mean", "float", "Pa", "24小时平均地表气压"],
    ["03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv", "power_nonzero_flag", "integer", "0/1", "电力排放是否大于0"],
    ["04_china_daily_power_carbon_climate_summary_2021_2026.csv", "china_grid_power_tco2_per_day", "float", "tCO2/day", "3848个0.5°中国陆地点排放求和"],
    ["05_renewable_resource_potential_china_0p5deg.csv", "annual_capacity_factor", "float", "0-1", "年平均容量因子"],
    ["05_renewable_resource_potential_china_0p5deg.csv", "capacity_potential_gw", "float", "GW", "可开发装机潜力"],
    ["06_vre_annual_capacity_factor_summary_china_2021_2060.csv", "mean_capacity_factor", "float", "0-1", "区域年度平均容量因子"],
    ["06_vre_annual_capacity_factor_summary_china_2021_2060.csv", "annual_generation_gwh", "float", "GWh", "按当前映射装机容量估算的年度发电量"],
  ];
  await writeFile(
    filePath,
    `${dictionary.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
    "utf8",
  );
  await recordFile(fileName, dictionary.length - 1);
  await updateProgress({ status: "running", stage: fileName, percent: 95 });
}

async function exportReadme(grid) {
  const fileName = "README_简易版数据说明.md";
  const filePath = path.join(outputRoot, fileName);
  const readme = `# 碳地球日尺度电力部门碳排放预测——课程作业简易版数据包

## 1. 数据包用途

本数据包从项目数据库中提取，面向统计机器学习课程作业。它不是完整平台数据库的复制，而是一个可独立分析、可复现、适合交给论文写作者的简化数据集。

核心研究对象是“中国0.5°网格日尺度电力部门碳排放”，预测变量是每个网格每天的电力部门碳排放量，主要解释变量包括气温、风速、太阳辐射、比湿和地表气压。

## 2. 时间和空间口径

- 历史碳数据：${carbonStart}—${endInclusive}，即原定88个月。
- 碳排放原始空间分辨率：0.1°×0.1°。
- 模型空间分辨率：0.5°×0.5°。
- 模型共同时间段：${modelStart}—${endInclusive}。
- 中国气候网格：${grid.pointCount}个陆地点，经度${grid.longitudeMin}—${grid.longitudeMax}，纬度${grid.latitudeMin}—${grid.latitudeMax}。
- 0.5°电力排放值由中心周围5×5个0.1°Power网格求和得到。
- 气候变量为GFDL-ESM4、SSP1-2.6情景数据，不等同于实时观测天气。

## 3. CSV文件

1. **01_carbon_all_sectors_daily_global_2019_2026.csv**  
   全球日尺度部门排放统计，用于趋势、部门比较和Power目标的全局基准。
2. **02_climate_daily_summary_china_2021_2026.csv**  
   五类气候变量的日尺度总体统计，用于数据核验。
3. **03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv**  
   主建模表。每一行是“日期×0.5°网格”，包含电力碳排放目标和五类气候特征。
4. **04_china_daily_power_carbon_climate_summary_2021_2026.csv**  
   已按日汇总的轻量表，适合先完成时间序列预测和绘图。
5. **05_renewable_resource_potential_china_0p5deg.csv**  
   风电、集中式光伏、分布式光伏、海上风电的资源和装机潜力。
6. **06_vre_annual_capacity_factor_summary_china_2021_2060.csv**  
   2021—2060年风电和光伏容量因子及估算发电量年度摘要。
7. **07_source_catalog_and_provenance.csv**  
   源文件、下载地址、校验值和元数据，用于论文数据来源说明。
8. **08_data_dictionary.csv**  
   字段、数据类型、单位和含义。

## 4. 建议的简易预测任务

### 任务A：全国日序列预测

使用04表，以china_grid_power_tco2_per_day为目标；增加1日、7日、14日滞后项、7日滚动均值、月份和星期特征，比较Elastic Net与随机森林或XGBoost。

### 任务B：0.5°网格面板预测

使用03表，以power_tco2_per_day为目标；输入气象变量、经纬度、日期特征和历史滞后排放，采用随机森林与XGBoost比较空间异质性。

课程作业优先建议任务A，因为样本规模适中、容易作图和解释；03表主要作为原始网格数据和扩展分析依据。

## 5. 科学使用限制

- 预测划分必须按时间顺序，不能随机打乱后将未来样本泄漏到训练集。
- 气候数据是情景模拟数据。与2021—2026碳数据联用时，应表述为“情景驱动变量下的关联预测”，避免声称其为实际逐日观测天气。
- 同一天其他部门排放不能直接作为真实未来预测特征，否则可能形成信息泄漏；可使用其滞后值做扩展分析。
- tCO2/day换算公式为：kgC/h × 24 × 44/12 ÷ 1000。
- 03表中的0值是有效的“无电力排放或源数据为0”记录，不应未经说明直接删除。
- 数据包不包含人口、GDP、真实分类型发电量、实际装机容量、用电负荷和跨区输电流量；这些属于后续扩展变量。
`;
  await writeFile(filePath, readme, "utf8");
  await recordFile(fileName, null);
  await updateProgress({ status: "running", stage: fileName, percent: 97 });
}

async function exportManifest() {
  const manifest = {
    packageName: "carbon_power_prediction_lite_v1",
    generatedAt: new Date().toISOString(),
    databaseSchema: "website_data",
    carbonPeriod: { start: carbonStart, end: endInclusive },
    modelPeriod: { start: modelStart, end: endInclusive },
    files: generatedFiles,
  };
  const fileName = "MANIFEST.json";
  await writeFile(
    path.join(outputRoot, fileName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await recordFile(fileName, null, false);
}

function hourlyPointMeans(compressed, pointCount) {
  const values = float32FromGzip(compressed);
  if (values.length !== pointCount * 24) {
    throw new Error(
      `Climate frame size mismatch: ${values.length}/${pointCount * 24}`,
    );
  }
  const means = new Float64Array(pointCount);
  const counts = new Uint8Array(pointCount);
  for (let hour = 0; hour < 24; hour += 1) {
    const offset = hour * pointCount;
    for (let index = 0; index < pointCount; index += 1) {
      const value = values[offset + index];
      if (Number.isFinite(value)) {
        means[index] += value;
        counts[index] += 1;
      }
    }
  }
  for (let index = 0; index < pointCount; index += 1) {
    means[index] = counts[index] ? means[index] / counts[index] : Number.NaN;
  }
  return means;
}

function aggregateCarbonAtClimatePoints(values, carbonRow, grid) {
  const width = Number(carbonRow.width);
  const height = Number(carbonRow.height);
  if (values.length !== width * height) {
    throw new Error(`Carbon frame size mismatch: ${values.length}/${width * height}`);
  }
  const longitudeMin = Number(carbonRow.longitude_min);
  const latitudeMax = Number(carbonRow.latitude_max);
  const dx = Number(carbonRow.dx);
  const dy = Number(carbonRow.dy);
  const output = new Float64Array(grid.pointCount);
  for (let point = 0; point < grid.pointCount; point += 1) {
    const centerColumn = Math.round(
      (Number(grid.longitude[point]) - longitudeMin) / dx,
    );
    const centerRow = Math.round(
      (latitudeMax - Number(grid.latitude[point])) / dy,
    );
    let sum = 0;
    for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
      const row = centerRow + rowOffset;
      if (row < 0 || row >= height) continue;
      const rowBase = row * width;
      for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
        const column = centerColumn + columnOffset;
        if (column < 0 || column >= width) continue;
        const value = values[rowBase + column];
        if (Number.isFinite(value) && value > 0) {
          sum += value;
        }
      }
    }
    output[point] = sum;
  }
  return output;
}

function float32FromGzip(buffer) {
  const decoded = gunzipSync(buffer);
  return new Float32Array(
    decoded.buffer,
    decoded.byteOffset,
    decoded.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function monthWindows(start, end) {
  const result = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor < finish) {
    const monthStart = cursor.toISOString().slice(0, 10);
    const next = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    );
    const monthEnd = next < finish ? next : finish;
    result.push([monthStart, monthEnd.toISOString().slice(0, 10)]);
    cursor = next;
  }
  return result;
}

function daysBetween(start, end) {
  return Math.round(
    (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) /
      86_400_000,
  );
}

async function recordFile(fileName, rows, hash = true) {
  const filePath = path.join(outputRoot, fileName);
  const info = await stat(filePath);
  const entry = {
    fileName,
    rows,
    sizeBytes: info.size,
  };
  if (hash) {
    entry.sha256 = await sha256File(filePath);
  }
  generatedFiles.push(entry);
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

async function updateProgress(payload) {
  const existing = await readFile(progressPath, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => ({}));
  await writeFile(
    progressPath,
    `${JSON.stringify({ ...existing, ...payload, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

async function writeChunk(stream, text) {
  if (!stream.write(text)) {
    await once(stream, "drain");
  }
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function numberText(value, digits = 8) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(digits).replace(/\.?0+$/, "");
}

function dateString(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

async function loadLocalEnvironment() {
  const envPath = path.join(repoRoot, ".env.local");
  const contents = await readFile(envPath, "utf8").catch(() => "");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2]
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
}
