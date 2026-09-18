import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync, cpSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logs = path.join(root, '.xiaoyun');
mkdirSync(logs, { recursive: true });

function listening(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function loadEnvFile(file) {
  const environment = { ...process.env };
  if (!existsSync(file)) return environment;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    environment[match[1]] = value;
  }
  return environment;
}

async function launch(name, args, env = process.env) {
  const out = openSync(path.join(logs, `${name}.out.log`), 'a');
  const err = openSync(path.join(logs, `${name}.err.log`), 'a');
  try {
    const child = spawn(process.execPath, args, {
      cwd: root, detached: true, windowsHide: true, env, stdio: ['ignore', out, err],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { closeSync(out); closeSync(err); }
}

function prepareStandalone() {
  const source = path.join(root, '.next', 'static');
  const target = path.join(root, '.next', 'standalone', '.next', 'static');
  if (existsSync(source) && !existsSync(target)) cpSync(source, target, { recursive: true });
}

try {
  if (!await listening(8765)) await launch('voice', ['node_modules/@xiaoyun/voice/bin/xiaoyun.mjs', 'start']);
  if (!await listening(3000)) {
    const built = existsSync(path.join(root, '.next/BUILD_ID'));
    if (built) {
      prepareStandalone();
      await launch('website', ['.next/standalone/server.js'], loadEnvFile(path.join(root, '.env.local')));
    } else {
      await launch('website', ['node_modules/next/dist/bin/next', 'dev', '--webpack',
        '--hostname', '127.0.0.1', '--port', '3000']);
    }
  }
  const deadline = Date.now() + 90000;
  while (!await listening(3000) || !await listening(8765)) {
    if (Date.now() > deadline) throw new Error(`启动超时，请查看 ${logs} 中的日志。`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log('本地网站：http://127.0.0.1:3000/china');
  if (!process.argv.includes('--no-open')) {
    const browser = spawn('powershell.exe', ['-NoProfile', '-Command', "Start-Process 'http://127.0.0.1:3000/china'"],
      { windowsHide: true, stdio: 'ignore' });
    browser.on('error', error => console.error(`请手动打开上方地址：${error.message}`));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
