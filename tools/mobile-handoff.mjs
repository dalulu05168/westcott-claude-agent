import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const header = 'WESTCOTT-HANDOFF v1';
const start = '<<< WESTCOTT HANDOFF >>>';
const bodyMarker = '<<< WESTCOTT BODY >>>';
const end = '<<< WESTCOTT END >>>';
const markerSet = new Set([start, bodyMarker, end]);
const fields = new Map([
  ['编号', 64], ['日期', 10], ['场次', 10], ['状态', 10], ['标题', 300], ['停点', 1000], ['下一步', 1000],
]);
const keyPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sessions = new Set(['上午', '下午', '晚间']);
const statuses = new Set(['草稿', '确认稿']);
const digest = (data) => createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex');

function parseEntries(documentText, validateDate) {
  const lines = documentText.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() === header);
  if (first < 0) throw new Error('Missing WESTCOTT-HANDOFF v1 header. Read the original handoff document.');
  const entries = [];
  const ids = new Set();
  let index = first + 1;
  while (index < lines.length) {
    const marker = lines[index].trim();
    if (!markerSet.has(marker)) {
      index += 1;
      continue;
    }
    if (marker !== start) throw new Error(`Unexpected handoff marker on line ${index + 1}.`);
    index += 1;
    const values = new Map();
    while (index < lines.length && lines[index].trim() !== bodyMarker) {
      const match = /^([^:：]+)[：:]\s*(.*)$/.exec(lines[index].trim());
      const field = match?.[1].trim();
      const value = match?.[2].trim();
      if (!fields.has(field) || !value || value.length > fields.get(field) || values.has(field)) {
        throw new Error(`Invalid or duplicate handoff field on line ${index + 1}.`);
      }
      values.set(field, value);
      index += 1;
    }
    if (index === lines.length || values.size !== fields.size) {
      throw new Error(`Incomplete handoff metadata near line ${index + 1}.`);
    }
    index += 1;
    const bodyLines = [];
    while (index < lines.length && lines[index].trim() !== end) {
      if (markerSet.has(lines[index].trim())) throw new Error(`Unexpected marker in body on line ${index + 1}.`);
      bodyLines.push(lines[index]);
      index += 1;
    }
    const body = bodyLines.join('\n');
    if (index === lines.length || !body.trim() || body.length > 120000) {
      throw new Error(`Missing, incomplete or oversized handoff body near line ${index + 1}.`);
    }
    index += 1;

    const id = values.get('编号');
    const date = values.get('日期');
    const session = values.get('场次');
    const status = values.get('状态');
    if (!keyPattern.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate handoff ID: ${id}`);
    if (!datePattern.test(date)) throw new Error(`Invalid date for handoff ${id}.`);
    validateDate(date);
    if (!sessions.has(session) || !statuses.has(status)) throw new Error(`Invalid session or status for handoff ${id}.`);
    ids.add(id);
    const entry = { id, date, session, status, title: values.get('标题'), stop: values.get('停点'),
      next: values.get('下一步'), body };
    entries.push({ ...entry, fingerprint: digest(entry) });
  }
  return entries;
}

function requireEntry(entries, id) {
  const entry = entries.find((row) => row.id === id);
  if (!entry) throw new Error(`Handoff ID not found: ${id}`);
  return entry;
}

async function getSourceUrl() {
  const config = JSON.parse(await readFile(new URL('../reference/mobile-handoff.json', import.meta.url), 'utf8'));
  if (!/^https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+\/edit$/.test(config.document_url)) {
    throw new Error('Invalid document_url in reference/mobile-handoff.json.');
  }
  return config.document_url;
}

function draftId(source, entry, phaseId, taskId) {
  const hex = digest([source, entry.id, entry.fingerprint, phaseId ?? null, taskId ?? null]).slice(0, 32);
  return `draft-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createMobileHandoff({ text, schema, shortId, validateDate, saveDraft }) {
  const entryIdField = { ...text(64), pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
  const definitions = [
    {
      name: 'preview_mobile_handoff',
      description: 'Parse original plain text from the configured Google Docs handoff inbox. With entry_id, return the exact entry including body and fingerprint. Does not write records.',
      inputSchema: schema({ document_text: text(500000), entry_id: entryIdField }, ['document_text']),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'import_mobile_handoff',
      description: 'After the user requests import, save one confirmed mobile handoff as a local draft. Reuse the fingerprint from preview. This does not adopt the draft or advance the agenda.',
      inputSchema: schema({
        document_text: text(500000), entry_id: entryIdField, fingerprint: { ...text(64), pattern: '^[0-9a-f]{64}$' },
        phase_id: shortId, task_id: shortId,
      }, ['document_text', 'entry_id', 'fingerprint']),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
  const handlers = {
    async preview_mobile_handoff({ document_text, entry_id }) {
      const source = await getSourceUrl();
      const entries = parseEntries(document_text, validateDate);
      if (entry_id) return { source, entry: requireEntry(entries, entry_id) };
      const index = entries.map(({ body, ...summary }) => summary);
      return { source, entries: index };
    },
    async import_mobile_handoff({ document_text, entry_id, fingerprint, phase_id, task_id }) {
      const source = await getSourceUrl();
      const entry = requireEntry(parseEntries(document_text, validateDate), entry_id);
      if (entry.status !== '确认稿') throw new Error('Only a confirmed mobile handoff can be imported.');
      if (entry.fingerprint !== fingerprint) throw new Error('The handoff changed. Preview the new version before importing.');
      const id = draftId(source, entry, phase_id, task_id);
      const mobile_handoff = { id: entry.id, fingerprint, session: entry.session, stop: entry.stop, next: entry.next };
      return saveDraft({
        date: entry.date, topic: entry.title, growth_step: entry.stop, next_question: entry.next,
        body: entry.body, source, phase_id, task_id,
      }, { id, mobile_handoff });
    },
  };
  return { definitions, handlers };
}
