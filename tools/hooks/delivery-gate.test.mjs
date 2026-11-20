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
const block = text => `\`\`\`text\n${text}\n\`\`\``;
let sequence = 0;
const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const say = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
function call(name, input, value, { error = false } = {}) {
  const id = `tool-${++sequence}`;
  const use = { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } };
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  const result = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(error ? { is_error: true } : {}) }] } };
  return [use, result];
}
const report = passed => ({ passed, issues: passed ? [] : [{ message: '测试未通过' }] });
const validation = (name, text = body, passed = true, options = {}) => call(`${S}${name}`, { body: text, ...(name === 'validate_speech_format' ? { strict_layout: true } : {}) }, report(passed), options);
const agent = (subagent_type, result) => call('Agent', { subagent_type, prompt: '本轮稿件' }, result);
function fullChecks(text = body) {
  return [
    ...validation('validate_speech_format', text),
    ...validation('validate_whatsapp_voice', text),
    ...agent('westcott-editor', '审稿结论：通过'),
  ];
}
function largeBody(count = 12) {
  return Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(2, '0')}男：\n第${index + 1}条`).join('\n\n');
}
function largeChecks(text) {
  return [
    ...agent('westcott-writer', '稿件已返回'),
    ...validation('validate_speech_format', text),
    ...validation('validate_whatsapp_voice', text),
    ...validation('validate_scene_count', text),
    ...agent('westcott-editor', '通过'),
  ];
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

t('没有剧本代码块时放行', () => {
  assert.equal(evaluate([user('检查进展'), say('一切正常')]).action, 'allow');
});
t('校验工具成功且审稿明确通过时放行', () => {
  assert.equal(evaluate([user('写下午场'), ...fullChecks(), say(block(body))]).action, 'allow');
});
t('缺少校验或审稿时阻止', () => {
  const result = evaluate([user('写下午场'), say(block(body))]);
  assert.equal(result.action, 'block');
  assert.match(result.reason, /validate_speech_format/);
  assert.match(result.reason, /validate_whatsapp_voice/);
  assert.match(result.reason, /westcott-editor/);
});
t('格式校验返回 passed false 时阻止', () => {
  const checks = [...validation('validate_speech_format', body, false), ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过')];
  const result = evaluate([user('写下午场'), ...checks, say(block(body))]);
  assert.equal(result.action, 'block');
  assert.match(result.reason, /passed: true/);
});
t('工具调用报错即使有内容也阻止', () => {
  const checks = [...validation('validate_speech_format', body, true, { error: true }), ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过')];
  const result = evaluate([user('写下午场'), ...checks, say(block(body))]);
  assert.equal(result.action, 'block');
  assert.match(result.reason, /调用失败或没有返回结果/);
});
t('工具调用没有配对结果时阻止', () => {
  const [unanswered] = call(`${S}validate_speech_format`, { body, strict_layout: true }, report(true));
  const checks = [...unanswered, ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过')];
  const result = evaluate([user('写下午场'), ...checks, say(block(body))]);
  assert.equal(result.action, 'block');
  assert.match(result.reason, /没有返回结果/);
});
t('格式校验正文与实际交付不一致时阻止', () => {
  const checks = [...validation('validate_speech_format', '14男：\n别的内容'), ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过')];
  const result = evaluate([user('写下午场'), ...checks, say(block(body))]);
  assert.equal(result.action, 'block');
  assert.match(result.reason, /正文与最终贴出的正文不一致/);
});
t('口吻校验必须针对实际交付正文', () => {
  const checks = [...validation('validate_speech_format'), ...validation('validate_whatsapp_voice', '14男：\n旧版本'), ...agent('westcott-editor', '通过')];
  assert.match(evaluate([user('写下午场'), ...checks, say(block(body))]).reason, /validate_whatsapp_voice 校验的正文/);
});
t('未启用严格排版校验时阻止', () => {
  const [use, result] = call(`${S}validate_speech_format`, { body, strict_layout: false }, report(true));
  const checks = [use, result, ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过')];
  assert.match(evaluate([user('写下午场'), ...checks, say(block(body))]).reason, /strict_layout: true/);
});
t('审稿需修改、无结论或调用失败时阻止', () => {
  for (const [review, options] of [['审稿结论：需修改', {}], ['整体看起来不错', {}], ['通过', { error: true }]]) {
    const checks = [...validation('validate_speech_format'), ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', review, options)];
    assert.equal(evaluate([user('写下午场'), ...checks, say(block(body))]).action, 'block');
  }
});
t('只接受格式校验返回的布尔 passed true', () => {
  const [use, result] = call(`${S}validate_speech_format`, { body, strict_layout: true }, { passed: 'true' });
  const checks = [use, result, ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过')];
  assert.equal(evaluate([user('写下午场'), ...checks, say(block(body))]).action, 'block');
});
t('角色台词达到 10 条时要求成功的条数校验和编剧结果', () => {
  const text = largeBody();
  assert.equal(countSpeeches(text), 12);
  assert.equal(evaluate([user('写上午场'), ...largeChecks(text), say(block(text))]).action, 'allow');
  const noCount = [...agent('westcott-writer', '稿件已返回'), ...validation('validate_speech_format', text), ...validation('validate_whatsapp_voice', text), ...agent('westcott-editor', '通过')];
  assert.match(evaluate([user('写上午场'), ...noCount, say(block(text))]).reason, /validate_scene_count/);
  const noWriter = [...validation('validate_speech_format', text), ...validation('validate_whatsapp_voice', text), ...validation('validate_scene_count', text), ...agent('westcott-editor', '通过')];
  assert.match(evaluate([user('写上午场'), ...noWriter, say(block(text))]).reason, /westcott-writer/);
});
t('条数校验未通过或针对其他正文时阻止', () => {
  const text = largeBody();
  for (const check of [validation('validate_scene_count', text, false), validation('validate_scene_count', '旧稿')]) {
    const checks = [...agent('westcott-writer', '稿件已返回'), ...validation('validate_speech_format', text), ...validation('validate_whatsapp_voice', text), ...check, ...agent('westcott-editor', '通过')];
    assert.equal(evaluate([user('写上午场'), ...checks, say(block(text))]).action, 'block');
  }
});
t('仅行尾空白和换行符差异视为一致', () => {
  const crlf = body.replace(/\n/g, '\r\n') + '  ';
  assert.equal(evaluate([user('写下午场'), ...fullChecks(crlf), say(block(body))]).action, 'allow');
});
t('只统计最近一次真实用户消息之后的调用', () => {
  const entries = [user('写上午场'), ...fullChecks(), say(block(body)), user('改第二条'), say(block(body))];
  assert.equal(evaluate(entries).action, 'block');
});
t('工具结果不会被当成新一轮，后台通知也不切断一轮', () => {
  const note = user('<task-notification>\n审稿完成\n</task-notification>');
  assert.equal(evaluate([user('写下午场'), ...fullChecks(), note, say(block(body))]).action, 'allow');
});
t('只读或明确跳过场景放行', () => {
  assert.equal(evaluate([user('只读，贴出原文'), say(block(body))]).action, 'allow');
  assert.equal(evaluate([user('导入手机稿'), ...call(`${S}import_mobile_handoff`, {}, '{}'), say(block(body))]).action, 'allow');
});
t('第二次触发仅警告并放行', () => {
  const result = evaluate([user('写下午场'), say(block(body))], { stopHookActive: true });
  assert.equal(result.action, 'warn');
  assert.match(result.message, /已按防死循环策略放行/);
});
t('子 Agent 旁链调用不计入主会话校验', () => {
  const [tool, result] = validation('validate_speech_format');
  tool.isSidechain = true;
  result.isSidechain = true;
  assert.equal(evaluate([user('写下午场'), tool, result, ...validation('validate_whatsapp_voice'), ...agent('westcott-editor', '通过'), say(block(body))]).action, 'block');
});

const dir = mkdtempSync(join(tmpdir(), 'westcott-gate-'));
try {
  const script = fileURLToPath(new URL('./delivery-gate.mjs', import.meta.url));
  const run = (entries, extra = {}) => {
    const path = join(dir, 't.jsonl');
    writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    return spawnSync(process.execPath, [script], { input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: path, ...extra }), encoding: 'utf8' });
  };
  t('脚本阻止时输出 decision: block', () => {
    const out = run([user('写下午场'), say(block(body))]);
    assert.equal(out.status, 0);
    assert.equal(JSON.parse(out.stdout).decision, 'block');
  });
  t('脚本对校验与审稿均通过的稿件放行', () => {
    const out = run([user('写下午场'), ...fullChecks(), say(block(body))]);
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
