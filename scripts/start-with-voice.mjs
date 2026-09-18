import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
for (const args of [
  ['node_modules/@xiaoyun/voice/bin/xiaoyun.mjs', 'start'],
  ['node_modules/next/dist/bin/next', process.argv.includes('--production') ? 'start' : 'dev', ...(process.argv.includes('--production') ? [] : ['--webpack']), '--hostname', '127.0.0.1', '--port', '3000'],
]) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); shutdown(1); });
  child.on('exit', code => { if (code) shutdown(code); });
}
function shutdown(code = 0) { for (const child of children) child.kill(); process.exitCode = code; }
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
