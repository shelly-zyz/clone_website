import test from "node:test";
import assert from "node:assert/strict";

import { buildAutoregressiveComparison, classifySdwpfRecord, parseSdwpfLine } from "./build-sdwpf-pilot.mjs";

const validLine = "1,1,00:10,6.17,-3.99,30.73,41.8,25.92,1.0,1.0,1.0,-0.25,494.66";

test("parses the official thirteen-column SDWPF schema", () => {
  const record = parseSdwpfLine(validLine);
  assert.equal(record.turbineId, 1);
  assert.equal(record.activePower, 494.66);
});

test("accepts a physically plausible SCADA row", () => {
  assert.equal(classifySdwpfRecord(parseSdwpfLine(validLine)), "valid");
});

test("quarantines missing observations", () => {
  assert.equal(classifySdwpfRecord(parseSdwpfLine("1,1,00:00,,,,,,,,,,")), "missing");
});

test("marks stopped or curtailed output as unknown using the published rule", () => {
  assert.equal(classifySdwpfRecord(parseSdwpfLine("1,1,00:10,6,-3,30,40,20,1,1,1,0,0")), "unknown");
});

test("rejects wind and nacelle directions outside published bounds", () => {
  assert.equal(classifySdwpfRecord(parseSdwpfLine("1,1,00:10,6,181,30,40,20,1,1,1,0,400")), "abnormal");
});

test("autoregressive comparison uses the fixed train and holdout day boundary", () => {
  const points = Array.from({ length: 245 * 144 }, (_, index) => ({
    day: Math.floor(index / 144) + 1,
    serialMinute: index * 10,
    powerMw: 20 + index * 0.01 + Math.sin(index / 12),
    meanWindSpeedMps: 6 + Math.sin(index / 20),
    usable: true,
  }));
  const result = buildAutoregressiveComparison(points, 6);
  assert.equal(result.horizonMinutes, 60);
  assert.ok(result.model.samples > 0);
  assert.ok(result.persistence.samples > 0);
});
