// 谷歌文档页签抽取的回归测试：node tools/doc-tabs.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTabs, loadDocument, tabText } from './doc-tabs.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };
const para = (text) => ({ paragraph: { elements: [{ textRun: { content: text } }] } });
const doc = {
  documentId: 'x', revisionId: 'r1',
  tabs: [
    { tabProperties: { tabId: 't.0', title: '11月汇总' }, documentTab: { body: { content: [para('汇总\n')] } },
      childTabs: [
        { tabProperties: { tabId: 't.a', title: '2026-11-19' }, documentTab: { body: { content: [
          para('===== 资讯助理 =====\n'), para('🌤 大家早上好！\n'),
          { table: { tableRows: [{ tableCells: [{ content: [para('表格里的字\n')] }] }] } },
          para('14男：\n'), para('BET今天怎么样？\n'),
        ] } } },
        { tabProperties: { tabId: 't.b', title: '2026-11-20' }, documentTab: { body: { content: [para('\n')] } } },
      ] },
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'westcott-doc-'));
try {
  t('读入官方连接器存下的结果文件（content 外壳）', () => {
    const file = join(dir, 'read_doc.txt');
    writeFileSync(file, JSON.stringify({ content: doc }));
    assert.equal(loadDocument(file).revisionId, 'r1');
  });
  t('读入 [{text}] 形式的结果文件', () => {
    const file = join(dir, 'read_doc2.txt');
    writeFileSync(file, JSON.stringify([{ type: 'text', text: JSON.stringify(doc) }]));
    assert.equal(loadDocument(file).documentId, 'x');
  });
  t('列出全部页签（含子页签）及字数，空页签字数为 0', () => {
    const tabs = listTabs(doc);
    assert.deepEqual(tabs.map((x) => x.title), ['11月汇总', '2026-11-19', '2026-11-20']);
    assert.equal(tabs.find((x) => x.title === '2026-11-20').chars, 0);
  });
  t('按日期取页签正文，表格内文字也取出', () => {
    const text = tabText(doc, '2026-11-19');
    assert.equal(text, '===== 资讯助理 =====\n🌤 大家早上好！\n表格里的字\n14男：\nBET今天怎么样？');
  });
  t('也可以按页签 ID 取', () => {
    assert.match(tabText(doc, 't.a'), /BET今天怎么样/);
  });
  t('找不到页签时报错并列出相近的日期页签', () => {
    assert.throws(() => tabText(doc, '2026-11-21'), /2026-11-19、2026-11-20/);
  });
  const real = join(homedir(), '.claude/projects/C--Users-pipi0-Desktop-westcott-efficient-workflow/36d7fcf4-a242-4cdf-b352-f9d761231cf5/tool-results');
  if (existsSync(real)) {
    const file = readdirSync(real).find((name) => name.includes('read_doc'));
    if (file) {
      t('真实文档快照能取出 2026-11-13 页签', () => {
        const d = loadDocument(join(real, file));
        assert.ok(tabText(d, '2026-11-13').includes('资讯助理'));
      });
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`PASS: doc-tabs ${n} 项`);
