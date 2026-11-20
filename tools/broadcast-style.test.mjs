// 助理播报格式与成员短句检查的回归测试：node tools/broadcast-style.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = mkdtempSync(join(tmpdir(), 'westcott-style-'));
const server = fileURLToPath(new URL('./course-state.mjs', import.meta.url));
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
function run(messages) {
  const out = spawnSync(process.execPath, [server], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    input: messages.map((m) => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', timeout: 5000,
  });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim().split('\n').map((line) => JSON.parse(line));
}
const decode = (r) => {
  assert.equal(r.result.isError, undefined, r.result.content?.[0]?.text);
  return JSON.parse(r.result.content[0].text);
};

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

const worldNews = [
  '===== 资讯助理 =====',
  '🌍 国际财经新闻｜大众汽车提议冻结工资，工会表示反对',
  '',
  '据今日报道，大众汽车提出冻结工资，并希望重新谈判35小时工作周。',
  '',
  '值得关注的是，罗马尼亚有不少零部件厂为德国车企供货。接下来，我们重点关注双方的谈判进展。',
  '配图：待补',
].join('\n');
const roNews = [
  '===== 资讯助理 =====',
  '🇷🇴 罗马尼亚财经新闻｜Banca Transilvania三季度净利润增长4%',
  '',
  '据今日公布的财报，TLV第三季度净利润13.49亿列伊，同比增长4%。',
  '',
  '对投资者来说，拨备和银行税拉低了利润增速。接下来，我们重点关注TLV今天的表现。',
  '配图：https://www.bancatransilvania.ro/files/press.jpg',
].join('\n');

try {
  t('国际新闻用 🌍 标题并以「配图：待补」占位时格式通过', () => {
    const [report] = run([call(1, 'validate_speech_format', { body: worldNews, mode: 'news' })]).map(decode);
    assert.equal(report.passed, true, JSON.stringify(report.issues));
  });
  t('罗马尼亚新闻带配图直链仍然通过', () => {
    const [report] = run([call(1, 'validate_speech_format', { body: roNews, mode: 'news' })]).map(decode);
    assert.equal(report.passed, true, JSON.stringify(report.issues));
  });
  t('配图行写其他文字仍不通过', () => {
    const [report] = run([call(1, 'validate_speech_format', { body: worldNews.replace('配图：待补', '配图：稍后'), mode: 'news' })]).map(decode);
    assert.equal(report.passed, false);
  });
  t('已核配图清单要求直链时，待补不能冒充已核', () => {
    const [report] = run([call(1, 'validate_speech_format', {
      body: worldNews, mode: 'news', expected_image_urls: ['https://example.org/a.jpg'],
    })]).map(decode);
    assert.equal(report.passed, false);
  });
  t('成员单条超过 35 字提示复查', () => {
    const long = '07女：\nBVB昨天十八点就收盘了，美股那时候还没收盘呢，所以今天开盘才是第一次真正反应昨晚的消息。';
    const [report] = run([call(1, 'validate_whatsapp_voice', { body: long })]).map(decode);
    assert.ok(report.issues.some((i) => i.type === 'member_length'), JSON.stringify(report.issues));
  });
  t('成员短句不提示长度', () => {
    const [report] = run([call(1, 'validate_whatsapp_voice', { body: '35男：\n利润涨4%，拨备是去年的三倍多😮' })]).map(decode);
    assert.ok(!report.issues.some((i) => i.type === 'member_length'));
  });
  t('成员替别人解释概念时提示复查', () => {
    const body = '48男：\nAnthropic是什么公司？\n23男：\n就是做 Claude 的那家AI公司，昨天在纳斯达克上市。';
    const [report] = run([call(1, 'validate_whatsapp_voice', { body })]).map(decode);
    assert.ok(report.issues.some((i) => i.type === 'member_explains'), JSON.stringify(report.issues));
  });
} finally {
  rmSync(project, { recursive: true, force: true });
}
console.log(`PASS: broadcast-style ${n} 项`);
