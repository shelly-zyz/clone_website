import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGfsIndexUrl,
  buildGfsUrl,
  generateTasks,
  parseGfsIndex,
  selectGfsWindRange,
} from "./acquire-hill-of-towie-gfs.mjs";

test("builds the official NOAA AWS GFS object and index URLs", () => {
  const issue = new Date("2025-01-01T00:00:00Z");
  assert.equal(buildGfsUrl(issue, 3), "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20250101/00/atmos/gfs.t00z.pgrb2.0p50.f003");
  assert.equal(buildGfsIndexUrl(issue, 6), "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20250101/00/atmos/gfs.t00z.pgrb2.0p50.f006.idx");
});

test("generates a 3-hour valid-time lattice without using a future issue", () => {
  const tasks = generateTasks("2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z");
  assert.equal(tasks.length, 9);
  assert.deepEqual(tasks[0], {
    issueTime: new Date("2024-12-31T18:00:00Z"),
    validTime: new Date("2025-01-01T00:00:00Z"),
    forecastHour: 6,
    url: buildGfsUrl(new Date("2024-12-31T18:00:00Z"), 6),
    indexUrl: buildGfsIndexUrl(new Date("2024-12-31T18:00:00Z"), 6),
  });
  assert.ok(tasks.every((task) => task.issueTime < task.validTime));
  assert.ok(tasks.every((task) => task.issueTime <= task.validTime));
});

test("parses NCEP index offsets and selects the contiguous 100 m U/V payload", () => {
  const index = [
    "1:100:d=2025010100:PRMSL:mean sea level:3 hour fcst:",
    "2:200:d=2025010100:UGRD:100 m above ground:3 hour fcst:",
    "3:500:d=2025010100:VGRD:100 m above ground:3 hour fcst:",
    "4:800:d=2025010100:TMP:1829 m above mean sea level:3 hour fcst:",
  ].join("\n");
  const records = parseGfsIndex(index);
  assert.equal(records.length, 4);
  assert.equal(records[1].end, 499);
  assert.deepEqual(selectGfsWindRange(index), {
    start: 200,
    end: 799,
    bytes: 600,
    fields: [
      { shortName: "UGRD", level: "100 m above ground", start: 200, end: 499 },
      { shortName: "VGRD", level: "100 m above ground", start: 500, end: 799 },
    ],
  });
});
