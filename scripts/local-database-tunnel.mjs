import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv, promisify } from "node:util";

const run = promisify(execFile);
const sslRequest = Buffer.alloc(8);
sslRequest.writeUInt32BE(8);
sslRequest.writeUInt32BE(80877103, 4);

function probePostgres(port) {
  return new Promise(resolve => {
    let connected = false;
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 2000 });
    function finish(status) {
      socket.destroy();
      resolve(status);
    }
    socket.once("connect", () => {
      connected = true;
      // PostgreSQL answers SSLRequest before authentication, even when TLS is disabled.
      socket.write(sslRequest);
    });
    socket.once("data", data => {
      finish(data.length === 1 && (data[0] === 0x53 || data[0] === 0x4e) ? "ready" : "unreachable");
    });
    socket.once("end", () => finish("unreachable"));
    socket.once("timeout", () => finish("unreachable"));
    socket.once("error", error => finish(!connected && error.code === "ECONNREFUSED" ? "closed" : "unreachable"));
  });
}

export function localDatabaseTunnel() {
  const directory = join(homedir(), ".config", "opengridworks");
  const path = join(directory, "database-tunnel.env");
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
    const localPort = Number(port);
    const socketPath = join(directory, `database-tunnel-${localPort}.sock`);
    // Leave room for OpenSSH's temporary suffix within macOS's Unix socket path limit.
    const controlSocket = process.platform !== "win32" && Buffer.byteLength(socketPath) < 86 ? socketPath : undefined;
    let status = await probePostgres(localPort);
    if (status === "ready") return;
    if (status === "unreachable") {
      // Only ask the SSH process started by this script to release its forward.
      if (controlSocket) {
        await run("ssh", ["-S", controlSocket, "-O", "exit", SSH_HOST], { timeout: 2_000 }).catch(() => {});
        status = await probePostgres(localPort);
        if (status === "ready") return;
      }
      if (status !== "closed") throw new Error(`本机端口 ${localPort} 未能转发到 PostgreSQL。`);
    }
    try {
      await run("ssh", [
        "-fNT", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=10",
        "-o", "IPQoS=none",
        ...(controlSocket ? ["-S", controlSocket, "-o", "ControlMaster=yes", "-o", "ControlPersist=no"] : []),
        "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
        "-L", `127.0.0.1:${port}:${PG_HOST}:${PG_PORT}`, SSH_HOST,
      ], { timeout: 15_000 });
    } catch {
      // Another preview may have established the shared forward in the meantime.
      if (await probePostgres(localPort) === "ready") return;
      throw new Error(`无法建立本机端口 ${localPort} 的数据库 SSH 隧道。`);
    }
    if (await probePostgres(localPort) !== "ready") {
      throw new Error(`本机端口 ${localPort} 的 SSH 隧道无法连到 PostgreSQL。`);
    }
  }
  return () => Promise.all(ports.map(ensure));
}
