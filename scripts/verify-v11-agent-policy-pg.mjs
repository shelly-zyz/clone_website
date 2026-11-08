import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageEntry = process.env.OGW_TEST_PGLITE_ENTRY;
if (!packageEntry) throw new Error("Set OGW_TEST_PGLITE_ENTRY to the absolute entry of a temporary @electric-sql/pglite install.");
const { PGlite } = await import(pathToFileURL(packageEntry).href);
const db = new PGlite();
const schema = name => readFileSync(new URL(name, import.meta.url), "utf8");
const root = new URL("../src/", import.meta.url).href;

async function withRole(role, operation, readOnly = false) {
  await db.exec(readOnly ? "BEGIN READ ONLY" : "BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${role}; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'`);
    const result = await operation(db);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

globalThis.ogwPgFixture = { withRole };
const fakeDatabase = `
  export class DataAgentError extends Error { constructor(code, message) { super(message); this.code=code; } }
  export const readDataAgent = run => globalThis.ogwPgFixture.withRole("green_agent_ro", run, true);
  export const runDataAgentWrite = (role, run) => globalThis.ogwPgFixture.withRole(role, run);
`;
registerHooks({
  resolve(specifier, context, next) {
    const url = specifier.startsWith("@/") ? new URL("../src/" + specifier.slice(2), import.meta.url)
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
    if (specifier === "pg" && context.parentURL?.endsWith("/run-analysis-worker.mjs")) {
      const source = `export class Client { async connect() {} async end() {} query(sql, params) { const db=globalThis.ogwPgFixture.db; return sql.startsWith("SET LOCAL") ? db.exec(sql) : db.query(sql, params); } }`;
      return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(source) };
    }
    if (url?.href === root + "lib/data-agent/pi.server") {
      const source = "export async function askDataAgent() { return globalThis.ogwPgFixture.queryAnswer(); }";
      return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(source) };
    }
    if (specifier === "server-only" || url?.href === root + "lib/data-agent/database.server") {
      return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(specifier === "server-only" ? "" : fakeDatabase) };
    }
    if (url?.href.startsWith(root) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    return next(specifier, context);
  },
});

try {
  await db.exec(`
    CREATE ROLE green_ddl; CREATE ROLE green_agent_context; CREATE ROLE green_agent_ingest;
    CREATE ROLE green_agent_review; CREATE ROLE green_agent_ro;
    CREATE SCHEMA catalog AUTHORIZATION green_ddl; CREATE SCHEMA semantic AUTHORIZATION green_ddl;
    CREATE SCHEMA standard AUTHORIZATION green_ddl; CREATE SCHEMA results AUTHORIZATION green_ddl;
    CREATE SCHEMA projects AUTHORIZATION green_ddl;
  `);
  // Only the production database-name guard is omitted in this disposable instance.
  await db.exec(schema("v11-data-agent-schema.sql").replace(/DO \$\$[\s\S]*?\$\$;/, ""));
  for (const migration of ["v11-data-agent-context.sql", "v11-business-agent-context.sql", "v11-xiaoyun-context.sql", "v11-agent-policy.sql", "v11-agent-policy.sql"]) {
    await db.exec(schema(migration));
  }
  const { queryData } = await import("../src/lib/data-agent/query.server.ts");
  const { dataQuerySchema } = await import("../src/lib/data-agent/contracts.ts");
  const { readyAnalysisCapabilities, createAgentSession, advanceAgentSession } = await import("../src/lib/agent-runtime/store.ts");
  const { updatePendingAnalysis } = await import("../src/lib/xiaoyun/pending.server.ts");

  await test("真实 SQL：同月各省按数值排名，排除全国、其他月份和缺测尾部", async () => {
    await db.exec(`
      INSERT INTO semantic.sem_metric VALUES
        ('power_nbs_monthly','power','generation','发电量','GWh','month','official_statistics','fixture','同口径','approved');
      INSERT INTO catalog.dataset_version(topic_id,dataset_id,version,is_current,row_count,metric_snapshot)
        SELECT 'power',dataset_id,repeat('a',64),true,5,to_jsonb(m) || '{"series_codes":["electricity"]}'::jsonb
        FROM semantic.sem_metric m;
      INSERT INTO standard.std_data_agent_fact
      SELECT 'power','power_nbs_monthly',1,'generation',entity,'electricity',month::timestamptz,NULL,value,
        CASE WHEN value IS NULL THEN 1 ELSE 0 END, jsonb_build_object('region_name',entity),lpad(idx::text,64,'0')
      FROM (VALUES (1,'000000000000','2026-09-01',500),(2,'320000000000','2026-09-01',9),
        (3,'330000000000','2026-09-01',100),(4,'340000000000','2026-09-01',NULL),
        (5,'320000000000','2026-10-01',900)) AS facts(idx,entity,month,value);
    `);
    const request = { topic: "power", province_comparison: true, start_date: "2026-09-01", end_date: "2026-09-30" };
    const ranked = await queryData(dataQuerySchema.parse(request));
    assert.deepEqual(ranked.rows.map(row => row.value), ["100", "9", null]);
    assert.equal(ranked.data_ref.shape, "category");
    assert.equal(ranked.data_ref.quality.missing_rows, 1);
    assert.equal(dataQuerySchema.safeParse({ ...request, end_date: "2026-10-31" }).success, false);
    await assert.rejects(withRole("green_agent_ro", client => client.query("SELECT * FROM projects.data_session")), { code: "42501" });
  });

  await test("真实权限：待办 CAS、就绪过期、审计仅追加且与业务写入同事务", async () => {
    const project_id = randomUUID(), session_id = randomUUID();
    await db.query("INSERT INTO projects.data_project(id,topic,name,access_hash) VALUES($1,'power','fixture',repeat('c',64))", [project_id]);
    await db.query("INSERT INTO projects.data_session(id,project_id) VALUES($1,$2)", [session_id, project_id]);
    const token = randomUUID(), resultId = randomUUID();
    await updatePendingAnalysis({ project_id, session_id }, 0, undefined, {
      token, resultId, revision: 0, expiresAt: Date.now() + 60000, plan: { operation: "backtest" }, reason: "fixture",
    });
    await assert.rejects(updatePendingAnalysis({ project_id, session_id }, 0, undefined, null), { code: "SESSION_CONFLICT" });
    await updatePendingAnalysis({ project_id, session_id }, 0, token, null);
    await withRole("green_agent_ingest", client => client.query(`
      INSERT INTO results.analysis_worker VALUES
      ($1,ARRAY['statsforecast'],'cpu',now()+interval '1 minute'),
      ($2,ARRAY['timesfm'],'cuda',now()-interval '1 minute')`, [randomUUID(), randomUUID()]));
    assert.deepEqual(await readyAnalysisCapabilities(), ["statsforecast"]);
    await assert.rejects(withRole("green_agent_context", client => client.query("DELETE FROM results.analysis_worker")), { code: "42501" });

    const snapshot = await createAgentSession(project_id, "visualization");
    const chart_id = randomUUID();
    assert.equal((await advanceAgentSession(snapshot, "visualization", { result_id: resultId, chart_id },
      { instruction: "Fixture value excluded from logs", status: "ok" })).status, "saved");
    assert.equal((await advanceAgentSession(snapshot, "visualization", { chart_id: randomUUID() },
      { instruction: "Conflict does not save", status: "ok" })).status, "conflict");
    const audit = await db.query("SELECT event FROM projects.agent_audit_event");
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].event.chart_id, chart_id);
    assert.equal(audit.rows[0].event.result_id, resultId);
    assert.ok(!JSON.stringify(audit.rows).includes("Fixture value"));
    await assert.rejects(withRole("green_agent_context", client => client.query("SELECT * FROM projects.agent_audit_event")), { code: "42501" });
    await assert.rejects(withRole("green_agent_context", client => client.query("DELETE FROM projects.agent_audit_event")), { code: "42501" });
  });

  await test("真实 SQL：同一请求重试复用查询收据，其他项目凭据不能读结果", async () => {
    const { createDataProject, createDataSession, askDataSession, resolveDataResult } = await import("../src/lib/data-agent/state.server.ts");
    const project = await createDataProject("power", "retry test");
    const session = await createDataSession(project.project_id, project.project_key);
    const query = dataQuerySchema.parse({ topic: "power", start_date: "2026-09-01", end_date: "2026-09-30", region_code: "320000000000" });
    const answer = await queryData(query);
    let asks = 0;
    globalThis.ogwPgFixture.queryAnswer = () => { asks++; return { ...answer, trace: ["query_approved_metric"] }; };
    const options = { originalMessage: "fixture question", latestVersion: false, requestId: randomUUID() };
    const first = await askDataSession("power", "fixture", session, project.project_key, new AbortController().signal, options);
    const retry = await askDataSession("power", "fixture", { ...session, revision: first.revision },
      project.project_key, new AbortController().signal, options);
    assert.equal(asks, 1);
    assert.equal(retry.result_id, first.result_id);
    assert.equal(retry.revision, 1);
    await assert.rejects(resolveDataResult(project.project_id, retry.result_id, "x".repeat(43)), { code: "PROJECT_NOT_FOUND" });
    const audits = await db.query("SELECT count(*)::integer AS total FROM projects.agent_audit_event WHERE event->>'action'='save_query'");
    assert.equal(audits.rows[0].total, 1);
  });

  await test("真实 Worker：跳过不支持的模型，领取并校验 StatsForecast 结果", {
    skip: !process.env.OGW_TEST_ANALYSIS_PYTHON,
  }, async () => {
    const project_id = randomUUID(), baseline = randomUUID(), other = randomUUID(), runId = randomUUID();
    await db.query("INSERT INTO projects.data_project(id,topic,name,access_hash) VALUES($1,'power','worker test',repeat('d',64))", [project_id]);
    const input = { grain: "month", unit: "GWh", metric: "Test generation", audit_run_id: runId,
      observations: Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2026, i, 1)).toISOString(), value: i })) };
    const dataRef = JSON.stringify({ version: "fixture" });
    const plan = { operation: "forecast", horizon: 2, horizonUnit: "month" };
    await db.query("INSERT INTO results.analysis_job(id,project_id,plan,input,data_ref,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 minute')",
      [other, project_id, JSON.stringify({ ...plan, model: "timesfm" }), JSON.stringify(input), dataRef]);
    await db.query("INSERT INTO results.analysis_job(id,project_id,plan,input,data_ref) VALUES($1,$2,$3,$4,$5)",
      [baseline, project_id, JSON.stringify({ ...plan, model: "statsforecast" }), JSON.stringify(input), dataRef]);
    globalThis.ogwPgFixture.db = db;
    const overrides = { DATA_AGENT_INGEST_DATABASE_URL: "fixture", OGW_ANALYSIS_DEVICE: "cpu",
      OGW_ANALYSIS_PYTHON: process.env.OGW_TEST_ANALYSIS_PYTHON, OGW_ANALYSIS_WORKER_MODELS: "statsforecast" };
    const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    process.argv.push("--once");
    try { await import("./run-analysis-worker.mjs"); }
    finally {
      process.argv.pop();
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    const { rows } = await db.query("SELECT id,status,result FROM results.analysis_job WHERE project_id=$1", [project_id]);
    assert.equal(rows.find(row => row.id === other).status, "queued");
    const completed = rows.find(row => row.id === baseline);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.result.model.name, "statsforecast");
    assert.equal(completed.result.points.length, 2);
    const events = await db.query("SELECT event FROM projects.agent_audit_event WHERE event->>'run_id'=$1 ORDER BY created_at", [runId]);
    assert.deepEqual(events.rows.map(row => row.event.action), ["claim", "compute"]);
  });
} finally {
  await db.close();
}
