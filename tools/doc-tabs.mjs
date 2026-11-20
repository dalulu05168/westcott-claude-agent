// 从官方 Google Docs 连接器 read_doc 的结果文件里，按日期页签抽出正文（照旧版做法）。
//
// 用法：先用官方连接器 read_doc 读文档 1frtoFvohP3u2HfRzBPRZVLOzMfvnO-8Vi9iX3r5rmiM；
// 结果太大时 Claude Code 会把它存成文件并给出路径，再运行：
//   node tools/doc-tabs.mjs <结果文件> --list          列出全部页签与字数
//   node tools/doc-tabs.mjs <结果文件> 2026-11-19      输出该日期页签的正文
//   node tools/doc-tabs.mjs <结果文件> 2026-11-19 --tail 80   只输出末尾 80 行
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadDocument(file) {
  let data = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(data)) data = data.find((part) => typeof part?.text === 'string')?.text ?? data[0];
  if (typeof data === 'string') data = JSON.parse(data);
  if (data?.content?.tabs) data = data.content;
  if (!data?.tabs) throw new Error('文件里没有找到文档页签（tabs）。请确认它是 read_doc 的结果。');
  return data;
}

function flatten(tabs, out = []) {
  for (const tab of tabs ?? []) {
    out.push(tab);
    flatten(tab.childTabs, out);
  }
  return out;
}

function contentText(content) {
  const parts = [];
  for (const element of content ?? []) {
    if (element.paragraph) {
      parts.push((element.paragraph.elements ?? []).map((e) => e.textRun?.content ?? '').join(''));
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) parts.push(contentText(cell.content));
      }
    }
  }
  return parts.join('');
}

const bodyText = (tab) => contentText(tab.documentTab?.body?.content).replace(/\n{2,}/g, '\n').trim();

export function listTabs(doc) {
  return flatten(doc.tabs).map((tab) => ({
    id: tab.tabProperties?.tabId, title: tab.tabProperties?.title ?? '', chars: bodyText(tab).length,
  }));
}

export function tabText(doc, key) {
  const tabs = flatten(doc.tabs);
  const tab = tabs.find((x) => x.tabProperties?.title === key || x.tabProperties?.tabId === key);
  if (!tab) {
    const dates = tabs.map((x) => x.tabProperties?.title ?? '').filter((title) => /^\d{4}-\d{2}-\d{2}$/.test(title));
    const near = dates.filter((title) => title.slice(0, 7) === key.slice(0, 7)).slice(-5);
    throw new Error(`找不到页签「${key}」。同月已有：${near.join('、') || '无'}`);
  }
  return bodyText(tab);
}

function main(argv) {
  const [file, key, ...rest] = argv;
  if (!file || !key) throw new Error('用法：node tools/doc-tabs.mjs <read_doc结果文件> <YYYY-MM-DD | 页签ID | --list> [--tail N]');
  const doc = loadDocument(file);
  if (key === '--list') {
    console.log(`修订：${doc.revisionId ?? '未知'}`);
    for (const tab of listTabs(doc)) console.log(`${tab.id}\t${tab.title}\t${tab.chars} 字`);
    return;
  }
  let text = tabText(doc, key);
  const at = rest.indexOf('--tail');
  if (at >= 0) text = text.split('\n').slice(-Number(rest[at + 1] || 80)).join('\n');
  console.log(`页签：${key}　修订：${doc.revisionId ?? '未知'}\n`);
  console.log(text || '（该页签为空）');
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
