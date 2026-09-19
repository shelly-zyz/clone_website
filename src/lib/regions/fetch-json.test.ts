import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error direct Node type-stripping test import
import { fetchDashboardJson } from "./fetch-json.ts";

test("a stalled response body times out and the same request can be retried", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }),
  }));
  // Keep Node alive while AbortSignal.timeout uses an unreferenced timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchDashboardJson("/summary", { timeoutMs: 20 }), { name: "TimeoutError" });
  } finally { clearInterval(keepAlive); }
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ count: 8899 }));
  assert.deepEqual(await fetchDashboardJson("/summary"), { count: 8899 });
});

test("switching region cancels an obsolete request", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => new Promise((_, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  const controller = new AbortController();
  const request = fetchDashboardJson("/summary", { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("HTTP errors fail instead of being treated as valid dashboard data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(fetchDashboardJson("/summary"), /503/);
});
