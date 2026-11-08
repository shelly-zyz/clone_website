import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { validAnalysisOutput } from "../src/lib/agent-runtime/analysis-result.ts";
import { Client } from "pg";

const worker = fileURLToPath(new URL("./analysis-models.py", import.meta.url));
const python = process.env.OGW_ANALYSIS_PYTHON?.trim() || "python3";
const device = process.env.OGW_ANALYSIS_DEVICE?.trim() || "cpu";
const connectionString = process.env.DATA_AGENT_INGEST_DATABASE_URL?.trim();
const stopped = new AbortController();
const once = process.argv.includes("--once");
process.once("SIGTERM", () => stopped.abort());
process.once("SIGINT", () => stopped.abort());

if (!connectionString) throw new Error("DATA_AGENT_INGEST_DATABASE_URL is required for the analysis worker.");

if (!["cpu", "cuda"].includes(device)) throw new Error("OGW_ANALYSIS_DEVICE must be cpu or cuda.");
const workerId = randomUUID();
const modelEnv = {
  PATH: process.env.PATH, HOME: homedir(), HF_HOME: process.env.HF_HOME,
  HF_HUB_OFFLINE: "1", CUDA_VISIBLE_DEVICES: device === "cpu" ? "" : process.env.CUDA_VISIBLE_DEVICES,
  OGW_ANALYSIS_DEVICE: device, NUMBA_CACHE_DIR: process.env.NUMBA_CACHE_DIR, OMP_NUM_THREADS: "2", OPENBLAS_NUM_THREADS: "2", MKL_NUM_THREADS: "2",
};
const requested = (process.env.OGW_ANALYSIS_WORKER_MODELS ?? "statsforecast").split(",").map(value => value.trim()).filter(Boolean);
if (requested.some(model => !["statsforecast", "timesfm", "chronos2"].includes(model))) throw new Error("Invalid Worker model configuration.");
const capabilities = JSON.parse(execFileSync(python, [worker, "--probe", ...requested], {
  env: modelEnv, timeout: 30_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
if (!Array.isArray(capabilities) || !capabilities.length || requested.some(model => !capabilities.includes(model))) {
  throw new Error("Configured analysis models failed the offline Worker probe.");
}
let lastHeartbeat = 0;

function audit(action, outcome, fields = {}) {
  console.info(JSON.stringify({ schema: "ogw.agent.audit.v1", time: new Date().toISOString(),
    actor: "analysis-worker", action, outcome, ...fields }));
}

async function persistAudit(client, job, action, outcome) {
  await client.query("INSERT INTO projects.agent_audit_event(event) VALUES($1::jsonb)", [JSON.stringify({
    schema: "ogw.agent.audit.v1", time: new Date().toISOString(), actor: "analysis-worker", action, outcome,
    job_id: job.id, project_id: job.project_id, run_id: job.input.audit_run_id ?? job.id,
  })]);
}

async function heartbeat() {
  if (Date.now() - lastHeartbeat < 10_000) return;
  await withIngestTransaction(async client => {
    await client.query(`
      INSERT INTO results.analysis_worker (id,capabilities,device,ready_until)
      VALUES ($1,$2,$3,now()+interval '200 seconds')
      ON CONFLICT (id) DO UPDATE SET ready_until=EXCLUDED.ready_until
    `, [workerId, capabilities, device]);
    await client.query("DELETE FROM results.analysis_worker WHERE ready_until < now()-interval '1 day'");
    const expired = await client.query(`
      UPDATE results.analysis_job j SET status='failed',error=CASE WHEN status='running' THEN '任务租约过期'
        ELSE '等待支持该模型的 Worker 超时' END, lease=NULL, lease_until=NULL, updated_at=now()
      WHERE (status='running' AND lease_until<=now() AND attempt>=2)
        OR ((status='queued' OR (status='running' AND lease_until<=now()))
          AND created_at<now()-interval '15 minutes' AND NOT EXISTS (
            SELECT 1 FROM results.analysis_worker w WHERE w.ready_until>now()
              AND COALESCE(j.plan->>'model',j.plan->>'operation')=ANY(w.capabilities)))
      RETURNING id,project_id,input
    `);
    for (const job of expired.rows) await persistAudit(client, job, "expire", "failed");
  });
  lastHeartbeat = Date.now();
}

async function withIngestTransaction(run) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 4_000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE green_agent_ingest");
    await client.query("SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = '20s'");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function claimAnalysisJob() {
  return withIngestTransaction(async client => {
    const selected = await client.query(`
      SELECT id,project_id,plan,input,created_at FROM results.analysis_job
      WHERE (status='queued' OR (status='running' AND lease_until<=now() AND attempt<2))
        AND COALESCE(plan->>'model',plan->>'operation')=ANY($1::text[])
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    `, [capabilities]);
    if (!selected.rowCount) return undefined;
    const lease = randomUUID();
    await client.query(`
      UPDATE results.analysis_job SET status='running',attempt=attempt+1,lease=$1,
        lease_until=now()+interval '190 seconds',updated_at=now() WHERE id=$2
    `, [lease, selected.rows[0].id]);
    const row = selected.rows[0];
    await persistAudit(client, row, "claim", "running");
    return { ...row, lease };
  });
}

async function finishAnalysisJob(job, output) {
  return withIngestTransaction(async client => {
    const success = "result" in output;
    const saved = await client.query(`
      UPDATE results.analysis_job SET status=$1,result=$2::jsonb,error=$3,updated_at=now(),lease=NULL,lease_until=NULL
      WHERE id=$4 AND lease=$5 AND status='running'
    `, [success ? "succeeded" : "failed", success ? JSON.stringify(output.result) : null,
      success ? null : output.error, job.id, job.lease]);
    if (saved.rowCount === 1) await persistAudit(client, job, "compute", success ? "succeeded" : "failed");
    return saved.rowCount === 1;
  });
}

function compute(task) {
  return new Promise(resolve => {
    const child = execFile(python, [worker], {
      timeout: 170_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, signal: stopped.signal,
      env: modelEnv,
    }, (error, stdout) => {
      if (error) {
        resolve({ error: error.killed ? "分析任务超时。" : "无法启动模型 Worker。" });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (!result || (result.result ? !validAnalysisOutput(result.result, task.plan) : typeof result.error !== "string")) throw new Error("Invalid worker output");
        resolve(result);
      } catch {
        resolve({ error: "Worker 返回了无效结果。" });
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ plan: task.plan, input: task.input }));
  });
}

try {
  while (!stopped.signal.aborted) {
    await heartbeat();
    const job = await claimAnalysisJob();
    if (!job) {
      if (once) break;
      await sleep(650, undefined, { signal: stopped.signal }).catch(() => undefined);
      continue;
    }
    const start = Date.now();
    audit("claim", "running", { job_id: job.id, run_id: job.input.audit_run_id ?? job.id, elapsed_ms: start - job.created_at.getTime() });
    const output = await compute(job);
    if (!stopped.signal.aborted) {
      const saved = await finishAnalysisJob(job, output);
      audit("compute", saved ? "error" in output ? "failed" : "succeeded" : "lease_lost",
        { job_id: job.id, run_id: job.input.audit_run_id ?? job.id, elapsed_ms: Date.now() - start });
    }
    if (once) break;
  }
} finally {
  await withIngestTransaction(client => client.query("DELETE FROM results.analysis_worker WHERE id=$1", [workerId])).catch(() => undefined);
}
