import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
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
    await client.query(`
      UPDATE results.analysis_job SET status='failed',error='任务租约过期',updated_at=now()
      WHERE status='running' AND lease_until<=now() AND attempt>=2
    `);
    const selected = await client.query(`
      SELECT id,plan,input FROM results.analysis_job
      WHERE status='queued' OR (status='running' AND lease_until<=now() AND attempt<2)
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    `);
    if (!selected.rowCount) return undefined;
    const lease = crypto.randomUUID();
    await client.query(`
      UPDATE results.analysis_job SET status='running',attempt=attempt+1,lease=$1,
        lease_until=now()+interval '190 seconds',updated_at=now() WHERE id=$2
    `, [lease, selected.rows[0].id]);
    return { id: selected.rows[0].id, lease, plan: selected.rows[0].plan, input: selected.rows[0].input };
  });
}

async function finishAnalysisJob(id, lease, output) {
  return withIngestTransaction(async client => {
    const success = "result" in output;
    await client.query(`
      UPDATE results.analysis_job SET status=$1,result=$2::jsonb,error=$3,updated_at=now(),lease=NULL,lease_until=NULL
      WHERE id=$4 AND lease=$5 AND status='running'
    `, [success ? "succeeded" : "failed", success ? JSON.stringify(output.result) : null,
      success ? null : output.error, id, lease]);
  });
}

function compute(task) {
  return new Promise(resolve => {
    const child = execFile(python, [worker], {
      timeout: 170_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, signal: stopped.signal,
      env: {
        PATH: process.env.PATH, HOME: homedir(), HF_HOME: process.env.HF_HOME,
        HF_HUB_OFFLINE: "1", CUDA_VISIBLE_DEVICES: device === "cpu" ? "" : process.env.CUDA_VISIBLE_DEVICES,
        OGW_ANALYSIS_DEVICE: device, OMP_NUM_THREADS: "2", OPENBLAS_NUM_THREADS: "2", MKL_NUM_THREADS: "2",
      },
    }, (error, stdout, stderr) => {
      if (error) {
        console.error("Analysis worker failed:", error.code ?? error.signal);
        resolve({ error: error.killed ? "分析任务超时。" : "无法启动模型 Worker。" });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (!result || (!result.result && typeof result.error !== "string")) throw new Error("Invalid worker output");
        if (result.error && stderr) console.error(stderr.slice(0, 350));
        resolve(result);
      } catch {
        resolve({ error: "Worker 返回了无效结果。" });
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ plan: task.plan, input: task.input }));
  });
}

while (!stopped.signal.aborted) {
  const job = await claimAnalysisJob();
  if (!job) {
    if (once) break;
    await sleep(650, undefined, { signal: stopped.signal }).catch(() => undefined);
    continue;
  }
  const output = await compute(job);
  if (!stopped.signal.aborted) {
    await finishAnalysisJob(job.id, job.lease, output);
    console.log(job.id, "error" in output ? "failed" : "succeeded");
  }
  if (once) break;
}
