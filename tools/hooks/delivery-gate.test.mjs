// 交稿把关脚本的回归测试：node tools/hooks/delivery-gate.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, countSpeeches } from './delivery-gate.mjs';

const S = 'mcp__westcott-state__';
const body = '14男：\n昨天 BET 跌了多少？\n\n===== 资讯助理 =====\n下午好。';
const block = `\`\`\`text\n${body}\n\`\`\``;
const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const use = (name, input = {}) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name, input }] } });
const say = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const editor = () => use('Agent', { subagent_type: 'westcott-editor', prompt: '审稿' });
const fullChecks = (b = body) => [
  use(`${S}validate_speech_format`, { body: b, strict_layout: true }), toolResult(),
  use(`${S}validate_whatsapp_voice`, { body: b }), toolResult(),
  editor(), toolResult(),
];

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

t('没有剧本代码块时放行', () => {
  assert.equal(evaluate([user('检查进展'), say('一切正常')]).action, 'allow');
});
t('贴出剧本但未审稿未校验时阻止', () => {
  const r = evaluate([user('写下午场'), say(block)]);
  assert.equal(r.action, 'block');
  assert.match(r.reason, /validate_speech_format/);
  assert.match(r.reason, /validate_whatsapp_voice/);
  assert.match(r.reason, /westcott-editor/);
});
t('审稿与校验齐全时放行', () => {
  assert.equal(evaluate([user('写下午场'), ...fullChecks(), say(block)]).action, 'allow');
});
t('校验过的正文与贴出的不一致时阻止', () => {
  const r = evaluate([user('写下午场'), ...fullChecks('14男：\n别的内容'), say(block)]);
  assert.equal(r.action, 'block');
  assert.match(r.reason, /不一致/);
});
t('仅行尾空白和换行符差异视为一致', () => {
  const crlf = body.replace(/\n/g, '\r\n') + '  ';
  assert.equal(evaluate([user('写下午场'), ...fullChecks(crlf), say(block)]).action, 'allow');
});
t('只看最近一次真实用户消息之后的调用', () => {
  const r = evaluate([user('写上午场'), ...fullChecks(), say(block), user('改第二条'), say(block)]);
  assert.equal(r.action, 'block');
});
t('工具结果不会被当成新一轮', () => {
  assert.equal(evaluate([user('写下午场'), ...fullChecks(), toolResult(), say(block)]).action, 'allow');
});
t('后台任务完成通知不会切断一轮', () => {
  const note = user('<task-notification>\n<task-id>a1</task-id>\n审稿完成\n</task-notification>');
  assert.equal(evaluate([user('写下午场'), ...fullChecks(), note, say(block)]).action, 'allow');
});
t('整场篇幅缺条数校验时阻止', () => {
  const big = Array.from({ length: 22 }, (_, i) => `${String(i + 1).padStart(2, '0')}男：\n第${i + 1}条`).join('\n');
  assert.equal(countSpeeches(big), 22);
  const r = evaluate([user('写下午场'), ...fullChecks(big), say(`\`\`\`text\n${big}\n\`\`\``)]);
  assert.equal(r.action, 'block');
  assert.match(r.reason, /validate_scene_count/);
  const ok = evaluate([user('写下午场'), ...fullChecks(big), use(`${S}validate_scene_count`, { body: big }), say(`\`\`\`text\n${big}\n\`\`\``)]);
  assert.equal(ok.action, 'allow');
});
t('入库样稿与只读请求放行', () => {
  assert.equal(evaluate([user('入库样稿 14男：昨天跌了'), say(block)]).action, 'allow');
  assert.equal(evaluate([user('只读，贴出原文'), say(block)]).action, 'allow');
  assert.equal(evaluate([user('导入手机稿'), use(`${S}import_mobile_handoff`), say(block)]).action, 'allow');
});
t('第二次触发只提醒不阻止', () => {
  const r = evaluate([user('写下午场'), say(block)], { stopHookActive: true });
  assert.equal(r.action, 'warn');
  assert.match(r.message, /已放行/);
});
t('子 Agent 旁链记录不计入', () => {
  const side = { ...use(`${S}validate_speech_format`, { body }), isSidechain: true };
  assert.equal(evaluate([user('写下午场'), side, say(block)]).action, 'block');
});

// 端到端：以 hook 方式运行脚本
const dir = mkdtempSync(join(tmpdir(), 'westcott-gate-'));
try {
  const script = fileURLToPath(new URL('./delivery-gate.mjs', import.meta.url));
  const run = (entries, extra = {}) => {
    const path = join(dir, 't.jsonl');
    writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    return spawnSync(process.execPath, [script], {
      input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: path, ...extra }), encoding: 'utf8',
    });
  };
  t('脚本阻止时输出 decision: block', () => {
    const out = run([user('写下午场'), say(block)]);
    assert.equal(out.status, 0);
    assert.equal(JSON.parse(out.stdout).decision, 'block');
  });
  t('脚本放行时无输出', () => {
    const out = run([user('写下午场'), ...fullChecks(), say(block)]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout, '');
  });
  t('输入损坏或对话记录缺失时静默放行', () => {
    const bad = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' });
    assert.equal(bad.status, 0);
    assert.equal(bad.stdout, '');
    const missing = spawnSync(process.execPath, [script], { input: JSON.stringify({ transcript_path: join(dir, 'none.jsonl') }), encoding: 'utf8' });
    assert.equal(missing.status, 0);
    assert.equal(missing.stdout, '');
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`PASS: delivery-gate ${n} 项`);
