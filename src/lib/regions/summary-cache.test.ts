import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error direct Node type-stripping test import
import { createSummaryCache } from "./summary-cache.ts";

test("concurrent requests share one calculation and reuse its result", async () => {
  const load = createSummaryCache<number>(300_000);
  let calls = 0;
  let finish!: (value: number) => void;
  const calculate = () => { calls += 1; return new Promise<number>((resolve) => { finish = resolve; }); };
  const first = load("CN:power", calculate);
  const second = load("CN:power", calculate);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(8899);
  assert.deepEqual(await Promise.all([first, second]), [8899, 8899]);
  assert.equal(await load("CN:power", calculate), 8899);
  assert.equal(calls, 1);
  assert.equal(await load("GD:power", async () => 12), 12);
});

test("failed calculations are removed so retry can recover", async () => {
  const load = createSummaryCache<number>(300_000);
  await assert.rejects(load("CN", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await load("CN", async () => 8899), 8899);
});

test("expired summaries are recalculated once for simultaneous callers", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const load = createSummaryCache<number>(100);
  let calls = 0;
  const calculate = async () => ++calls;
  assert.equal(await load("CN", calculate), 1);
  t.mock.timers.tick(101);
  assert.deepEqual(await Promise.all([load("CN", calculate), load("CN", calculate)]), [2, 2]);
  assert.equal(calls, 2);
});
