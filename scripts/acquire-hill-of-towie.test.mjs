import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquire, assertDestinationInside, parseArguments, selectFiles } from "./acquire-hill-of-towie.mjs";

test("metadata is the safe default and large files require explicit flags", () => {
  const manifest = { files: [
    { kind: "metadata", name: "meta.csv" },
    { kind: "shutdown", name: "shutdown.zip" },
    { kind: "scada", year: 2024, name: "2024.zip" },
  ] };
  assert.deepEqual(selectFiles(manifest, parseArguments([])).map((file) => file.name), ["meta.csv"]);
  assert.deepEqual(selectFiles(manifest, parseArguments(["--include-shutdowns", "--year", "2024"])).map((file) => file.name), ["meta.csv", "shutdown.zip", "2024.zip"]);
  assert.throws(() => selectFiles(manifest, parseArguments(["--year", "2023"])), /not present/);
});

test("download destinations cannot escape the selected output directory", () => {
  const root = path.resolve("safe-output");
  assert.equal(assertDestinationInside(root, "metadata.csv"), path.join(root, "metadata.csv"));
  assert.throws(() => assertDestinationInside(root, "../outside.csv"), /Unsafe/);
});

test("acquisition verifies checksum and keeps the production gate locked", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hill-of-towie-test-"));
  const body = "field,value\nname,test\n";
  const md5 = createHash("md5").update(body).digest("hex");
  const manifest = {
    id: "test-source", name: "Test source", doi: "10.test/source", recordUrl: "https://example.test/record", license: "CC-BY-4.0",
    files: [{ id: "meta", kind: "metadata", name: "meta.csv", md5, maxBytes: 1024 }]
  };
  const testManifest = path.join(directory, "manifest.json");
  await writeFile(testManifest, JSON.stringify(manifest), "utf8");
  const result = await acquire({ outputDir: directory, includeShutdowns: false, years: [] }, {
    manifestPath: testManifest,
    fetchImpl: async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } }),
  });
  assert.equal(result.acquisition.status, "metadata-verified");
  assert.equal(result.acquisition.files[0].status, "downloaded-verified");
  assert.equal(result.productionGate.unlocked, false);
  assert.match(await readFile(path.join(directory, "meta.csv"), "utf8"), /name,test/);
});
