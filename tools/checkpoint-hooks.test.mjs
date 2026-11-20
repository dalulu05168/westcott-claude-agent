// 跨场钩子保存的回归测试：node tools/checkpoint-hooks.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./course-state.mjs', import.meta.url));
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
function run(project, messages) {
  const out = spawnSync(process.execPath, [server], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    input: messages.map((m) => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', timeout: 5000,
  });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim().split('\n').map((line) => JSON.parse(line));
}
const text = (r) => r.result.content[0].text;

const body = [
  '===== 资讯助理 =====',
  '🌤 大家早上好！欢迎回到 ELLERY WESTCOTT 社群！',
  '14男：',
  'ANT涨17%，指数还跌2%，这两件事是一回事吗？🤷',
  '12男：',
  '拨备多，是因为贷款多了，还是坏账多了？',
].join('\n');
const save = (hooks) => call(1, 'save_scene_checkpoint', {
  date: '2026-11-20', session: 'morning', expected_revision: 0, track: 'final', mode: 'replace',
  coverage: 'from_start', status: 'closed', body, summary: '测试', planned_news: [], hooks,
  node: '闭群', unresolved: [], source: { ref: '测试' }, confirmation: '测试',
});

let n = 0;
const t = (name, fn) => {
  const project = mkdtempSync(join(tmpdir(), 'westcott-hooks-'));
  try { fn(project); } finally { rmSync(project, { recursive: true, force: true }); }
  n++; console.log(`ok - ${name}`);
};

t('钩子的角色写成「12男」不带冒号也能保存', (project) => {
  const [r] = run(project, [save([{ speaker: '12男', quote: '拨备多，是因为贷款多了，还是坏账多了？', target: 'afternoon', question: '拨备来源' }])]);
  assert.equal(r.result.isError, undefined, text(r));
});
t('原话对不上时，报错指出是第几条钩子并给出该成员的原话', (project) => {
  const [r] = run(project, [save([{ speaker: '12男：', quote: '拨备为什么这么多？', target: 'afternoon', question: '拨备来源' }])]);
  assert.equal(r.result.isError, true);
  assert.match(text(r), /第 1 条钩子/);
  assert.match(text(r), /拨备多，是因为贷款多了，还是坏账多了？/);
});
t('角色不在正文里时，报错列出正文中的成员标记', (project) => {
  const [r] = run(project, [save([{ speaker: '33男', quote: '随便一句', target: 'afternoon', question: '无' }])]);
  assert.equal(r.result.isError, true);
  assert.match(text(r), /14男/);
});
console.log(`PASS: checkpoint-hooks ${n} 项`);
