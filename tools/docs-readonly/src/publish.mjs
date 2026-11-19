import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { checkedTab, ReadError, readParagraphs } from './transcript.mjs';

const runProcess = promisify(execFile);
const validId = /^(?:draft|adopted)-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u;
const canonicalNewlines = text => text.replace(/\r\n?/gu, '\n');
const docsLink = (id, tab) => `https://docs.google.com/document/d/${id}/edit?tab=${tab}`;

export async function readSavedRecord(entry, id) {
  try {
    const response = await new Promise((resolveRead, rejectRead) => {
      const process = runProcess(process.execPath, [entry], {
        env: { ...process.env, WESTCOTT_PROJECT_DIR: resolve(dirname(entry), '..') },
        timeout: 10_000,
        maxBuffer: 2_000_000,
        windowsHide: true,
      });
      process.child.stdin.on('error', rejectRead);
      process.child.stdin.end(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
          name: 'read_record', arguments: { id, view: 'full' },
        },
      }) + '\n');
      process.then(resolveRead, rejectRead);
    });
    const reply = JSON.parse(response.stdout.trim());
    if (reply.result.isError) throw new Error();
    return JSON.parse(reply.result.content[0].text);
  } catch {
    throw new ReadError('LOCAL_RECORD_MISSING', '无法从本项目的 westcott-state 读回指定稿件。');
  }
}

function exactKeys(args, keys) {
  return args && typeof args === 'object'
    && Object.keys(args).every(key => keys.includes(key));
}

function wholeTabText(tab) {
  return Array.from(readParagraphs(tab.documentTab.body.content)).join('');
}

function hasReceipt(tab, name, body) {
  const entries = tab.documentTab.namedRanges?.[name]?.namedRanges ?? [];
  if (!entries.length) return false;
  const ranges = entries.length === 1 ? entries[0].ranges : [];
  const range = ranges?.length === 1 ? ranges[0] : null;
  if (!range || !Number.isInteger(range.startIndex) || range.endIndex - range.startIndex !== body.length) {
    throw new ReadError('APPEND_RECEIPT_MISMATCH', '已有同一稿件的写入标记，正文范围已变更，请人工核对。');
  }
  let text = '';
  for (const item of tab.documentTab.body.content) {
    for (const part of item.paragraph?.elements ?? []) {
      const content = part.textRun?.content;
      if (typeof content !== 'string' || !Number.isInteger(part.startIndex)) continue;
      const start = Math.max(0, range.startIndex - part.startIndex);
      const end = Math.min(content.length, range.endIndex - part.startIndex);
      if (start < end) text += content.slice(start, end);
    }
  }
  if (text !== body) {
    throw new ReadError('APPEND_RECEIPT_MISMATCH', '已有同一稿件的写入标记，正文读回不一致，请人工核对。');
  }
  return true;
}

async function appendRecord({ args, source, client, recordReader }) {
  if (!exactKeys(args, ['draft_id', 'document_id', 'tab_id']) || typeof args.draft_id !== 'string' || !validId.test(args.draft_id)
    || typeof args.document_id !== 'string' || typeof args.tab_id !== 'string') {
    throw new ReadError('INVALID_INPUT', '请提供本项目稿件 ID、目标文档 ID 和 tabId。');
  }
  const target = source.publish_target;
  if (!target || !target.document_id || !target.document_title || !target.tab_id || !target.tab_title) {
    throw new ReadError('WRITE_TARGET_UNCONFIGURED', '请先配置用户指定的剧本写入文档和页签。');
  }
  if (args.document_id !== target.document_id || args.tab_id !== target.tab_id) {
    throw new ReadError('WRITE_TARGET_DENIED', '目标与许可的剧本页签不一致。');
  }
  const record = await recordReader(args.draft_id);
  if (record?.id !== args.draft_id || !['draft', 'adopted'].includes(record.kind)
    || typeof record.body !== 'string' || !record.body.trim() || record.body.length > 120000) {
    throw new ReadError('INVALID_RECORD', '本地稿件无有效正文。');
  }
  const body = canonicalNewlines(record.body);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff]/u.test(body)) {
    throw new ReadError('UNSUPPORTED_TEXT', '稿件包含 Google Docs 可能移除的字符，请先核对原稿。');
  }
  const key = 'westcott_' + createHash('sha256').update(args.draft_id).digest('hex');
  const before = await client.getDocument(target.document_id);
  const tab = checkedTab(before, target);
  const receipt = status => ({
    status, draft_id: args.draft_id, tab_id: target.tab_id, tab_title: target.tab_title,
    source_url: docsLink(target.document_id, target.tab_id),
  });
  if (hasReceipt(tab, key, body)) return receipt('already_appended');
  const last = tab.documentTab.body.content.at(-1);
  if (typeof before.revisionId !== 'string' || !before.revisionId
    || !last?.paragraph || !Number.isSafeInteger(last.endIndex) || last.endIndex < 2) {
    throw new ReadError('APPEND_POSITION_UNKNOWN', '无法核对最新文档修订或目标页签末尾的位置。');
  }
  const start = last.endIndex - 1;
  const prefix = start === 1 ? '' : '\n\n';
  try {
    await client.batchUpdate(target.document_id, {
      writeControl: { requiredRevisionId: before.revisionId },
      requests: [
        { insertText: { location: { index: start, tabId: target.tab_id }, text: prefix + body } },
        { createNamedRange: { name: key, range: {
          startIndex: start + prefix.length, endIndex: start + prefix.length + body.length, tabId: target.tab_id,
        } } },
      ],
    });
  } catch (error) {
    if (error.code === 'DOC_WRITE_ACCESS' || error.code === 'GOOGLE_AUTH') throw error;
    const current = await client.getDocument(target.document_id);
    if (hasReceipt(checkedTab(current, target), key, body)) return receipt('already_appended');
    throw error;
  }
  const after = checkedTab(await client.getDocument(target.document_id), target);
  if (!hasReceipt(after, key, body)) {
    throw new ReadError('APPEND_UNCONFIRMED', 'Google 已响应写入请求，但正文或写入标记未能读回核实。');
  }
  return receipt('appended');
}

const string = { type: 'string', minLength: 1, maxLength: 300 };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export function createExtraTools({ source, client, recordReader }) {
  return [
    {
      definition: {
        name: 'get_tab_text',
        description: 'Read text from an allowed Google Docs tab by exact tab ID. Follow next_offset until null.',
        inputSchema: schema({ tab_id: string, offset: { type: 'integer', minimum: 0 } }, ['tab_id']),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async run(args) {
        const offset = args?.offset ?? 0;
        if (!exactKeys(args, ['tab_id', 'offset']) || typeof args.tab_id !== 'string'
          || !Number.isSafeInteger(offset) || offset < 0) {
          throw new ReadError('INVALID_INPUT', '请提供有效的 tabId 和文本偏移。');
        }
        const publishing = source.publish_target?.tab_id === args.tab_id ? source.publish_target : null;
        const primary = source.reference_tab_ids?.includes(args.tab_id) || Object.hasOwn(source.tabs, args.tab_id);
        if (!primary && !publishing) throw new ReadError('SOURCE_NOT_ALLOWED', '指定 tabId 不在读取许可内。');
        const target = primary ? { ...source, tab_id: args.tab_id, tab_title: source.tabs[args.tab_id] } : publishing;
        const document = await client.getDocument(target.document_id);
        const tab = checkedTab(document, target);
        const text = Array.from(wholeTabText(tab));
        const end = offset + 12000;
        return {
          tab_id: args.tab_id, tab_title: tab.tabProperties.title, revision_id: document.revisionId ?? null,
          text: text.slice(offset, end).join(''), next_offset: end < text.length ? end : null,
          source_url: docsLink(target.document_id, args.tab_id),
        };
      },
    },
    {
      definition: {
        name: 'append_saved_script',
        description: 'Append an independently reviewed script saved to westcott-state to the configured Google Docs tab. Pass its immutable record ID. Read back a receipt.',
        inputSchema: schema({ draft_id: string, document_id: string, tab_id: string }, ['draft_id','document_id','tab_id']),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      run: args => appendRecord({ args, source, client, recordReader }),
    },
  ];
}
