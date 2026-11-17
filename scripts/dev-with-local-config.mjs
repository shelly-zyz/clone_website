import { spawn } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { localDatabaseTunnel } from "./local-database-tunnel.mjs";

const configDirectory = join(homedir(), ".config", "opengridworks");
const allowedVariables = new Set([
  "DATABASE_URL",
  "DATA_AGENT_DATABASE_URL",
  "DATA_AGENT_INGEST_DATABASE_URL",
  "DATA_AGENT_REVIEW_DATABASE_URL",
  "DATA_AGENT_STATE_DATABASE_URL",
  "DATA_AGENT_PI_ENABLED",
  "DATA_AGENT_PI_MODEL",
  "DATA_AGENT_PI_THINKING_LEVEL",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "WEATHER_REPLAY_S3_ENDPOINT",
  "WEATHER_REPLAY_S3_ACCESS_KEY",
  "WEATHER_REPLAY_S3_SECRET_KEY",
]);

for (const fileName of ["map-database.env", "data-agent-database.env", "xiaoyun-providers.env", "weather-replay.env"]) {
  const filePath = join(configDirectory, fileName);
  let metadata;
  try {
    metadata = lstatSync(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
    throw error;
  }

  if (!metadata.isFile()) throw new Error(`本机配置必须是普通文件：${filePath}`);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`本机配置文件必须限制为当前用户可读：${filePath}`);
  }

  const values = parseEnv(readFileSync(filePath, "utf8"));
  for (const [name, value] of Object.entries(values)) {
    if (allowedVariables.has(name) && process.env[name] === undefined) process.env[name] = value;
  }
}

const ensureDatabaseTunnel = localDatabaseTunnel();
let tunnelCheck;
if (ensureDatabaseTunnel) {
  const reconnect = async () => {
    try { await ensureDatabaseTunnel(); }
    catch (error) { console.warn(error.message); }
    finally { tunnelCheck = setTimeout(reconnect, 15_000).unref(); }
  };
  await reconnect();
}

const next = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => next.kill(signal));
}

next.once("error", (error) => {
  console.error(`无法启动 Next.js 开发服务器：${error.message}`);
  process.exitCode = 1;
});

next.once("exit", (code, signal) => {
  clearTimeout(tunnelCheck);
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
});
