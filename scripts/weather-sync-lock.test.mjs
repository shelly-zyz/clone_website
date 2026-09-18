import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireWeatherSyncLock, releaseWeatherSyncLock } from "./weather-sync-lock.mjs";

test("recovers one explicit stale lock and releases only its own replacement", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weather-lock-"));
  const lockPath = path.join(directory, "live-sync.lock");
  await fs.writeFile(lockPath, JSON.stringify({ pid: 999_999_999, startedAt: "2026-09-09T00:00:00Z" }));
  const lock = await acquireWeatherSyncLock(lockPath, new Date("2026-09-18T00:00:00Z"));
  assert.equal(lock.recovered.pid, 999_999_999);
  assert.equal(JSON.parse(await fs.readFile(lockPath, "utf8")).pid, process.pid);
  await releaseWeatherSyncLock(lockPath, lock);
  await assert.rejects(fs.stat(lockPath), { code: "ENOENT" });
  await fs.rmdir(directory);
});

test("does not steal a live process lock", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weather-lock-"));
  const lockPath = path.join(directory, "live-sync.lock");
  await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await assert.rejects(acquireWeatherSyncLock(lockPath), /active/);
  assert.equal(JSON.parse(await fs.readFile(lockPath, "utf8")).pid, process.pid);
  await fs.unlink(lockPath);
  await fs.rmdir(directory);
});
