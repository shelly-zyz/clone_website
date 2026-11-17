import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv, promisify } from "node:util";

const run = promisify(execFile);

function localListener(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 1000 });
    function finish(listening) {
      socket.destroy();
      resolve(listening);
    }
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export function localDatabaseTunnel() {
  const path = join(homedir(), ".config", "opengridworks", "database-tunnel.env");
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077))) {
    throw new Error("数据库隧道配置必须是当前用户专用的普通文件。");
  }
  const { SSH_HOST, PG_HOST, PG_PORT = "5432", LOCAL_PORT, AGENT_LOCAL_PORT } = parseEnv(readFileSync(path, "utf8"));
  const ports = [...new Set([LOCAL_PORT, AGENT_LOCAL_PORT].filter(Boolean))];
  const validHost = value => /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value ?? "");
  const validPort = value => /^\d{1,5}$/.test(value ?? "") && Number(value) > 0 && Number(value) <= 65535;
  if (!validHost(SSH_HOST) || !validHost(PG_HOST) || !validPort(PG_PORT) || !validPort(LOCAL_PORT) || !ports.every(validPort)) {
    throw new Error("数据库隧道配置中的主机或端口无效。");
  }
  async function ensure(port) {
    if (await localListener(Number(port))) return;
    try {
      await run("ssh", [
        "-fNT", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=10",
        "-o", "IPQoS=none",
        "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
        "-L", `127.0.0.1:${port}:${PG_HOST}:${PG_PORT}`, SSH_HOST,
      ], { timeout: 15_000 });
    } catch {
      // Another preview may have established the shared forward in the meantime.
      if (!await localListener(Number(port))) throw new Error("无法连接已配置的数据库 SSH 隧道。");
    }
  }
  return () => Promise.all(ports.map(ensure));
}
