import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const statusLogPath = path.join(repoRoot, "carbon-db-only-autoresume-backfill.status.log");
const progressTextPath = path.join(repoRoot, "carbon-db-only-progress.txt");
const progressJsonPath = path.join(repoRoot, "carbon-db-only-progress.json");
const scratchRoot = path.join(workspaceRoot, "data", "carbon-graced-minscratch", "scratch", "_current");
const carbonChunkSizeBytes = 32 * 1024;

const sectors = [
  "Power",
  "total",
  "Industry",
  "Residential",
  "GroundTransportation",
  "DomesticAviation",
  "InternationalAviation",
  "InternationalShipping",
];
const startDate = "2019-01-01";
const endDate = "2026-05-31";

await loadLocalEnvironment();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 15_000,
  max: 1,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

try {
  const expectedResult = await queryWithRetry(
      `select count(*)::int as expected_days
       from generate_series($1::date, $2::date, interval '1 day') as day`,
      [startDate, endDate],
    );
  const sectorResult = await queryWithRetry(
      `with expected_days as (
         select count(*)::int as days
         from generate_series($2::date, $3::date, interval '1 day') as day
       ),
       expected_months as (
         select month_start,
                extract(day from (month_start + interval '1 month - 1 day'))::int as expected_frames
         from generate_series(date '2019-01-01', date '2026-05-01', interval '1 month') as month_start
       ),
       actual_months as (
         select sector,
                date_trunc('month', observed_on)::date as month_start,
                count(distinct observed_on)::int as frames
         from website_data.carbon_emission_frames
         where sector = any($1)
         group by sector, date_trunc('month', observed_on)::date
       ),
       complete_months as (
         select actual_months.sector, count(*)::int as months
         from actual_months
         join expected_months using (month_start)
         where actual_months.frames >= expected_months.expected_frames
         group by actual_months.sector
       )
       select expected.sector,
              coalesce(actual.frames, 0)::int as frames,
              expected_days.days::int as expected_frames,
              coalesce(complete_months.months, 0)::int as months,
              to_char(actual.min_date, 'YYYY-MM-DD') as min_date,
              to_char(actual.max_date, 'YYYY-MM-DD') as max_date
       from unnest($1::text[]) with ordinality as expected(sector, sort_order)
       cross join expected_days
       left join complete_months on complete_months.sector = expected.sector
       left join (
         select sector,
                count(distinct observed_on)::int as frames,
                min(observed_on) as min_date,
                max(observed_on) as max_date
         from website_data.carbon_emission_frames
         where sector = any($1)
         group by sector
       ) actual on actual.sector = expected.sector
       order by expected.sort_order`,
      [sectors, startDate, endDate],
    );
  const missingResult = await queryWithRetry(
      `with expected_sectors as (select unnest($1::text[]) as sector),
       expected_months as (
         select month_start,
                extract(day from (month_start + interval '1 month - 1 day'))::int as expected_frames
         from generate_series(date '2019-01-01', date '2026-05-01', interval '1 month') as month_start
       ),
       expected as (select sector, month_start from expected_sectors cross join expected_months),
       existing as (
         select sector,
                date_trunc('month', observed_on)::date as month_start,
                count(distinct observed_on)::int as frames
         from website_data.carbon_emission_frames
         where sector = any($1)
         group by sector, date_trunc('month', observed_on)::date
       )
       select expected.sector,
              to_char(min(expected.month_start), 'YYYY-MM') as first_missing,
              count(*)::int as missing_months
       from expected
       join expected_months using (month_start)
       left join existing using (sector, month_start)
       where coalesce(existing.frames, 0) < expected_months.expected_frames
       group by expected.sector
       order by array_position($1, expected.sector)`,
      [sectors],
    );
  const duplicateResult = await queryWithRetry(
      `select count(*)::int as duplicate_day_groups
       from (
         select sector, observed_on
         from website_data.carbon_emission_frames
         where sector = any($1)
         group by sector, observed_on
         having count(*) > 1
       ) duplicates`,
      [sectors],
    );

  const expectedFramesPerSector = expectedResult.rows[0].expected_days;
  const expectedFramesTotal = expectedFramesPerSector * sectors.length;
  const sectorRows = sectorResult.rows.map((row) => ({
    sector: row.sector,
    frames: row.frames,
    expectedFrames: row.expected_frames,
    percent: percent(row.frames, row.expected_frames),
    months: row.months,
    minDate: row.min_date,
    maxDate: row.max_date,
    firstMissing: null,
    missingMonths: 0,
  }));
  const missingBySector = new Map(missingResult.rows.map((row) => [row.sector, row]));
  for (const row of sectorRows) {
    const missing = missingBySector.get(row.sector);
    if (missing) {
      row.firstMissing = missing.first_missing;
      row.missingMonths = missing.missing_months;
    }
  }

  const importedFramesTotal = sectorRows.reduce((sum, row) => sum + row.frames, 0);
  const lastStatus = await readLastStatus();
  const scratch = await readScratchProgress(lastStatus);
  const chunkProgress = await readChunkProgress(pool, lastStatus);
  const payload = {
    generatedAt: new Date().toISOString(),
    range: { startDate, endDate },
    overall: {
      frames: importedFramesTotal,
      expectedFrames: expectedFramesTotal,
      percent: percent(importedFramesTotal, expectedFramesTotal),
      remainingFrames: expectedFramesTotal - importedFramesTotal,
    },
    current: lastStatus,
    scratch,
    chunkProgress,
    duplicateDayGroups: duplicateResult.rows[0].duplicate_day_groups,
    sectors: sectorRows,
  };

  const text = renderProgress(payload);
  console.log(text);
  if (process.argv.includes("--write")) {
    await fs.writeFile(progressTextPath, `${text}\n`, "utf8");
    await fs.writeFile(progressJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
} finally {
  await pool.end();
}

async function loadLocalEnvironment() {
  const contents = await fs.readFile(path.join(repoRoot, ".env.local"), "utf8").catch(() => "");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

async function queryWithRetry(text, params = []) {
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await pool.query(text, params);
    } catch (error) {
      lastError = error;
      if (attempt < 8) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
  }
  throw lastError;
}

async function readLastStatus() {
  const contents = await fs.readFile(statusLogPath, "utf8").catch(() => "");
  const lines = contents.trim().split(/\r?\n/).filter(Boolean);
  const lastMeaningful = [...lines].reverse().find((line) =>
    /\] (START|SYNC|IMPORT|DONE|SKIP sector|carbon GRACED DB-only backfill completed)/.test(line),
  );
  if (!lastMeaningful) {
    return { line: null, phase: "unknown", sector: null, month: null };
  }
  const timestampMatch = lastMeaningful.match(/^\[(?<timestamp>[^\]]+)\]/);
  const match = lastMeaningful.match(/\] (?<phase>START|SYNC|IMPORT|DONE) (?<sector>\S+) (?<month>\d{4}-\d{2})/);
  return {
    line: lastMeaningful,
    timestamp: timestampMatch?.groups?.timestamp ?? null,
    phase: match?.groups?.phase ?? "status",
    sector: match?.groups?.sector ?? null,
    month: match?.groups?.month ?? null,
  };
}

async function readScratchProgress(current) {
  if (!current?.sector || !current?.month) {
    return null;
  }
  const processedRoot = path.join(scratchRoot, "processed");
  const archive = await statSummary(path.join(scratchRoot, "archive.nc.tar.gz"));
  const archivePart = await statSummary(path.join(scratchRoot, "archive.nc.tar.gz.part"));
  const netcdf = await statSummary(path.join(scratchRoot, "work", "emission.nc"));
  const manifest = await readCurrentManifest(path.join(processedRoot, "manifest.json"), current);
  const expectedDays = daysInMonth(current.month);
  const startedAt = current.timestamp ? new Date(current.timestamp).getTime() : 0;
  const frameFiles = await fs.readdir(processedRoot, { withFileTypes: true }).catch(() => []);
  let recentFrameCount = 0;
  let latestFrame = null;
  for (const entry of frameFiles) {
    if (!entry.isFile() || !/^\d{2}\.f32\.gz$/.test(entry.name)) {
      continue;
    }
    const fullPath = path.join(processedRoot, entry.name);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || stats.mtimeMs < startedAt) {
      continue;
    }
    recentFrameCount += 1;
    if (!latestFrame || stats.mtimeMs > latestFrame.updatedAtMs) {
      latestFrame = {
        name: entry.name,
        day: Number.parseInt(entry.name.slice(0, 2), 10),
        mb: Number((stats.size / 1024 / 1024).toFixed(2)),
        updatedAt: stats.mtime.toISOString(),
        updatedAtMs: stats.mtimeMs,
      };
    }
  }
  if (latestFrame) {
    delete latestFrame.updatedAtMs;
  }
  return {
    scratchRoot,
    archive,
    archivePart,
    netcdf,
    manifest,
    recentFrameCount,
    expectedDays,
    recentFramePercent: percent(recentFrameCount, expectedDays),
    latestFrame,
  };
}

async function statSummary(filePath) {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats) {
    return null;
  }
  return {
    mb: Number((stats.size / 1024 / 1024).toFixed(2)),
    updatedAt: stats.mtime.toISOString(),
  };
}

async function readCurrentManifest(filePath, current) {
  try {
    const manifest = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (manifest?.sector !== current.sector || manifest?.month !== current.month) {
      return null;
    }
    return {
      sector: manifest.sector,
      month: manifest.month,
      frames: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
    };
  } catch {
    return null;
  }
}

async function readChunkProgress(pool, current) {
  if (!current?.sector || !current?.month) {
    return null;
  }
  const missingResult = await queryWithRetry(
    `with days as (
       select day::date as observed_on
       from generate_series($2::date, ($2::date + interval '1 month - 1 day')::date, interval '1 day') as day
     )
     select to_char(min(days.observed_on), 'YYYY-MM-DD') as observed_on
     from days
     left join website_data.carbon_emission_frames frames
       on frames.observed_on = days.observed_on
      and frames.sector = $1
     where frames.observed_on is null`,
    [current.sector, `${current.month}-01`],
  );
  const observedOn = missingResult.rows[0]?.observed_on;
  if (!observedOn) {
    return null;
  }

  const manifestPath = path.join(scratchRoot, "processed", "manifest.json");
  let expectedChunks = null;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const frame = Array.isArray(manifest.frames)
      ? manifest.frames.find((item) => item.date === observedOn)
      : null;
    if (frame?.sizeBytes) {
      expectedChunks = Math.ceil(frame.sizeBytes / carbonChunkSizeBytes);
    }
  } catch {
    expectedChunks = null;
  }

  const chunksResult = await queryWithRetry(
    `select count(*)::int as chunks,
            coalesce(sum(octet_length(chunk_data)), 0)::int as bytes,
            max(chunk_index)::int as max_chunk
       from website_data.carbon_emission_frame_chunks
      where observed_on = $1::date
        and sector = $2`,
    [observedOn, current.sector],
  );
  const chunks = chunksResult.rows[0];
  return {
    observedOn,
    chunks: chunks.chunks,
    expectedChunks,
    percent: expectedChunks ? percent(chunks.chunks, expectedChunks) : null,
    mb: Number((chunks.bytes / 1024 / 1024).toFixed(2)),
    maxChunk: chunks.max_chunk,
  };
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function percent(value, total) {
  return total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0;
}

function renderProgress(payload) {
  const lines = [];
  lines.push(`Carbon backfill progress @ ${new Date(payload.generatedAt).toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`Overall: ${payload.overall.frames}/${payload.overall.expectedFrames} frames (${payload.overall.percent}%) ${bar(payload.overall.percent)}`);
  lines.push(`Remaining: ${payload.overall.remainingFrames} frames`);
  lines.push(`Current: ${payload.current.line ?? "unknown"}`);
  if (payload.scratch) {
    const scratchParts = [];
    if (payload.scratch.manifest) {
      scratchParts.push(`manifest ${payload.scratch.manifest.frames}/${payload.scratch.expectedDays} frames ready`);
    } else if (payload.scratch.recentFrameCount > 0) {
      scratchParts.push(`local frames ${payload.scratch.recentFrameCount}/${payload.scratch.expectedDays} (${payload.scratch.recentFramePercent}%)`);
    }
    if (payload.scratch.latestFrame) {
      scratchParts.push(`latest ${payload.scratch.latestFrame.name}`);
    }
    if (payload.scratch.archivePart) {
      scratchParts.push(`download part ${payload.scratch.archivePart.mb} MB`);
    } else if (payload.scratch.archive) {
      scratchParts.push(`archive ${payload.scratch.archive.mb} MB`);
    }
    if (scratchParts.length > 0) {
      lines.push(`Current local: ${scratchParts.join(", ")}`);
    }
  }
  if (payload.chunkProgress && payload.chunkProgress.chunks > 0) {
    const expected = payload.chunkProgress.expectedChunks ?? "?";
    const percentText = payload.chunkProgress.percent === null ? "" : ` (${payload.chunkProgress.percent}%)`;
    lines.push(
      `Current chunk: ${payload.chunkProgress.observedOn} ${payload.chunkProgress.chunks}/${expected}${percentText}, ${payload.chunkProgress.mb} MB committed`,
    );
  }
  lines.push(`Duplicate day groups: ${payload.duplicateDayGroups}`);
  lines.push("");
  lines.push("By sector:");
  for (const row of payload.sectors) {
    const missing = row.firstMissing ? `first missing ${row.firstMissing}, missing ${row.missingMonths} months` : "complete";
    lines.push(
      `- ${row.sector}: ${row.frames}/${row.expectedFrames} (${row.percent}%), months ${row.months}/89, max ${row.maxDate ?? "-"}, ${missing}`,
    );
  }
  lines.push("");
  lines.push("Note: imports are committed per day; the current month may appear partially until all days finish.");
  return lines.join("\n");
}

function bar(percentValue) {
  const width = 24;
  const done = Math.round((percentValue / 100) * width);
  return `[${"#".repeat(done)}${"-".repeat(width - done)}]`;
}
