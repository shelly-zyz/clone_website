import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import project from '../voice-project.mjs';

test('Qwen tool paraphrasing cannot replace the original user question', async () => {
  const originalFetch = globalThis.fetch;
  let submitted;
  globalThis.fetch = async (_url, init) => {
    submitted = JSON.parse(init.body);
    return Response.json({ status: 'answered', message: 'verified test response' });
  };
  try {
    await project.tools[0].execute({ question: '查询全部能源设施' }, {
      signal: new AbortController().signal, taskId: 'test',
      contextAtStart: { selectedProvince: '山东' }, originalQuestion: '广东有多少已映射光伏设施',
    });
    assert.equal(submitted.question, '广东有多少已映射光伏设施');
    assert.equal(submitted.context.selectedProvince, '山东');
  } finally { globalThis.fetch = originalFetch; }
});

test('China dashboard mounts Xiaoyun on startup while keeping the detail panel on demand', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'src/components/china-dashboard/ChinaDashboardShell.tsx');
  const source = await readFile(file, 'utf8');
  assert.match(source, /\{askOpen \? <AskEnergyPanel[\s\S]*?\/\> : null\}\s*<XiaoyunAssistant/);
  assert.doesNotMatch(source, /\{askOpen \? <XiaoyunAssistant/);
});

test('Earth shell mounts the same Xiaoyun assistant with Earth context', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'src/components/opengridworks/MapAppShell.tsx');
  const source = await readFile(file, 'utf8');
  assert.match(source, /import \{ XiaoyunAssistant \} from "@\/components\/china-dashboard\/XiaoyunAssistant"/);
  assert.match(source, /<XiaoyunAssistant[\s\S]*page="earth"[\s\S]*selectedProvince: activeRegion\.label/);
});
