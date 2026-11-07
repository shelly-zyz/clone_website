import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { claimAnalysisJob, finishAnalysisJob } from "./analysis-worker-state.mjs";

const worker = fileURLToPath(new URL("./analysis-models.py", import.meta.url));
const python = process.env.OGW_ANALYSIS_PYTHON?.trim() || "python3";
const device = process.env.OGW_ANALYSIS_DEVICE?.trim() || "cpu";
const stopped = new AbortController();
const once = process.argv.includes("--once");
process.once("SIGTERM", () => stopped.abort());
process.once("SIGINT", () => stopped.abort());

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
  const job = claimAnalysisJob();
  if (!job) {
    if (once) break;
    await sleep(650, undefined, { signal: stopped.signal }).catch(() => undefined);
    continue;
  }
  const output = await compute(job);
  if (!stopped.signal.aborted) {
    finishAnalysisJob(job.id, job.lease, output);
    console.log(job.id, "error" in output ? "failed" : "succeeded");
  }
  if (once) break;
}
