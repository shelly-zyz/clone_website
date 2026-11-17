import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { localDatabaseTunnel } from "./local-database-tunnel.mjs";

const args = process.argv.slice(2);
const port = args.find(arg => arg !== "--no-open") ?? "3193";
if (args.length > 2 || !/^\d{4,5}$/.test(port) || Number(port) > 65535 ||
    args.some(arg => arg !== port && arg !== "--no-open")) {
  throw new Error("Usage: npm run preview:open -- [PORT] [--no-open]");
}
const origin = `http://127.0.0.1:${port}`;
await localDatabaseTunnel()?.();

async function requestHome() {
  return fetch(origin, { redirect: "error", signal: AbortSignal.timeout(4000) });
}

if (!await requestHome().catch(() => null)) {
  const directory = join(homedir(), ".config", "opengridworks");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const log = openSync(join(directory, `preview-${port}.log`), "a", 0o600);
  try {
    spawn(process.execPath, ["scripts/dev-with-local-config.mjs", "--hostname", "127.0.0.1", "--port", port],
      { detached: true, stdio: ["ignore", log, log] }).unref();
  } finally {
    closeSync(log);
  }
}

const deadline = Date.now() + 55_000;
let home;
while (Date.now() < deadline) {
  home = await requestHome().catch(() => null);
  if (home?.ok && (await home.text()).includes("OpenGridWorks")) break;
  home = null;
  await delay(750);
}
if (!home) throw new Error(`未找到可用的 OpenGridWorks 预览 ${origin}。`);

const validate = spawn(process.execPath, ["scripts/check-preview.mjs", origin], { stdio: "inherit" });
const code = await new Promise((resolve, reject) => {
  validate.once("error", reject);
  validate.once("exit", resolve);
});
if (code !== 0) throw new Error("整站预检未通过，请查看上方连接结果。");
if (!args.includes("--no-open")) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const browse = spawn(command, [origin], { stdio: "inherit" });
  await new Promise((resolve, reject) => {
    browse.once("error", reject);
    browse.once("exit", code => code === 0 || process.platform === "win32" && code === 1
      ? resolve() : reject(new Error("无法打开浏览器。")));
  });
}
console.log(origin);
