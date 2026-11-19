import { createHash, randomUUID } from 'node:crypto';
import { appendFile, link, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createDayOperations } from './day-operations.mjs';
import { createMobileHandoff } from './mobile-handoff.mjs';
import { createMemberCast } from './member-cast.mjs';
import { createLessonKit } from './lesson-kit.mjs';
import { createSpeechFormatTool, getBlocks, transcriptBreak } from './speech-format.mjs';
import { createWhatsAppVoiceTool } from './whatsapp-voice.mjs';
import { createNewsBroadcastTools } from './news-broadcast.mjs';
import { createSceneCheckpointTools, sceneSession } from './scene-checkpoint.mjs';
import { createRevisionStore, latestSnapshotIds } from './state-revisions.mjs';
import { createLocalEditTool } from './local-edit.mjs';
import { createMarketOperationsTool } from './market-operations.mjs';

const project = process.env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL('../', import.meta.url));
const state = resolve(project, '.westcott-state');
const idPattern = /^(draft|adopted)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const agendaPattern = /^agenda-(\d{6})$/;
const completionPattern = /^(lesson-completion-[0-9a-f]{64})-\d{6}$/;
const maxRevision = 999999;
const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const shortId = { ...text(64), pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
const dateField = { ...text(10), pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const phaseSchema = schema({ id: shortId, title: text(300), goal: text(1500) }, ['id', 'title', 'goal']);
const taskSchema = schema({
  id: shortId, course: text(300), goal: text(1500), leave_for_later: text(1000), scheduled_date: dateField,
}, ['id', 'course', 'goal']);
const dayOperations = createDayOperations({ text, schema, dateField, validateDate, listIds, readEntry, insertRecord });
const mobileHandoff = createMobileHandoff({ text, schema, shortId, validateDate, saveDraft });
const memberCast = createMemberCast({ text, schema, dateField, validateDate, listIds, readEntry, insertRecord });
const lessonKit = createLessonKit({ text, schema, getRecord, checkState, state });
const speechFormat = createSpeechFormatTool({ text, schema, dateField, validateDate });
const whatsappVoice = createWhatsAppVoiceTool({ text, schema });
const newsBroadcast = createNewsBroadcastTools({ text, schema, dateField, validateDate, getHandoff: dayOperations.handlers.get_handoff });
const sceneCheckpoints = createSceneCheckpointTools({ text, schema, dateField, validateDate, listIds, readEntry,
  insertRecord, getRecord, getHandoff: dayOperations.handlers.get_handoff });
const completionStore = createRevisionStore({ listIds, readEntry, insertRecord });
const localEdit = createLocalEditTool({ text, schema });
const marketOperations = createMarketOperationsTool({ text, schema, dateField, validateDate });
const definitions = [
  {
    name: 'list_records',
    description: 'List recent Westcott records. Defaults to adopted records for official course continuity.',
    inputSchema: schema({ kind: { type: 'string', enum: ['draft', 'adopted', 'all'] },
      limit: { type: 'integer', minimum: 1, maximum: 30 } }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_record',
    description: 'Read one local record. Use view: tail for a bounded excerpt with course and source metadata.',
    inputSchema: schema({ id: text(44), view: { ...text(8), enum: ['tail', 'full'] } }, ['id']),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_agenda',
    description: 'Get the approved phase, ordered tasks, explicitly completed lessons (including legacy adoptions), and the next pending task.',
    inputSchema: schema({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'save_agenda',
    description: 'Save an explicitly approved agenda revision. Read get_agenda first and preserve stable IDs for existing tasks.',
    inputSchema: schema({
      expected_revision: { type: 'integer', minimum: 0, maximum: maxRevision - 1 },
      phase: phaseSchema, source: text(2000),
      tasks: { type: 'array', items: taskSchema, minItems: 1, maxItems: 30 },
    }, ['expected_revision', 'phase', 'source', 'tasks']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'save_draft',
    description: 'Save a local draft. Set lesson_scope to full_lesson only for a complete lesson version. Saving does not adopt it.',
    inputSchema: schema({
      date: dateField,
      topic: text(300), growth_step: text(1000), next_question: text(1000),
      body: text(120000), source: text(2000), phase_id: shortId, task_id: shortId, session: sceneSession,
      lesson_scope: { ...text(20), enum: ['segment', 'full_lesson'] },
    }, ['date', 'topic', 'growth_step', 'body']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'record_adoption',
    description: 'Record explicit user adoption of a shown section or draft. This does not complete a lesson or confirm that anything was actually sent.',
    inputSchema: schema({ id: text(44), approval: text(1000) }, ['id', 'approval']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'complete_lesson',
    description: 'Record explicit user confirmation of a completed lesson. Use an adopted full_lesson ID. To replace a completed version, pass its current adopted ID in supersedes.',
    inputSchema: schema({ id: text(44), confirmation: text(1000), supersedes: text(44) }, ['id', 'confirmation']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  ...sceneCheckpoints.definitions,
  {
    name: 'append_gold_sample',
    description: 'Append user-supplied dialogue to reference/gold-samples.md when the user explicitly says 入库样稿. This is a style reference.',
    inputSchema: schema({ date: dateField, body: text(12000) }, ['date', 'body']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  ...dayOperations.definitions,
  ...mobileHandoff.definitions,
  ...memberCast.definitions,
  ...lessonKit.definitions,
  ...speechFormat.definitions,
  ...whatsappVoice.definitions,
  ...newsBroadcast.definitions,
  ...localEdit.definitions,
  ...marketOperations.definitions,
];

function validate(input, inputSchema) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an argument object.');
  for (const key of inputSchema.required) {
    if (!Object.hasOwn(input, key)) throw new Error(`Missing argument: ${key}`);
  }
  for (const [key, value] of Object.entries(input)) {
    const rule = Object.hasOwn(inputSchema.properties, key) && inputSchema.properties[key];
    if (!rule) throw new Error(`Unknown argument: ${key}`);
    validateValue(value, rule, key);
  }
}

function validateValue(value, rule, key) {
  if (rule.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > rule.maxLength)) {
    throw new Error(`Invalid text: ${key}`);
  }
  if (rule.pattern && !new RegExp(rule.pattern).test(value)) throw new Error(`Invalid format: ${key}`);
  if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid choice: ${key}`);
  if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) {
    throw new Error(`Invalid integer: ${key}`);
  }
  if (rule.type === 'number' && (!Number.isFinite(value) || value < rule.minimum || value > rule.maximum)) {
    throw new Error(`Invalid number: ${key}`);
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid boolean: ${key}`);
  if (rule.type === 'object') validate(value, rule);
  if (rule.type === 'array') {
    if (!Array.isArray(value) || value.length < rule.minItems || value.length > rule.maxItems) {
      throw new Error(`Invalid number of entries: ${key}`);
    }
    for (const item of value) validateValue(item, rule.items, key);
  }
}

function validateDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Use a valid Bucharest calendar date as YYYY-MM-DD.');
  }
}

async function checkState(create = false) {
  if (create) await mkdir(state, { recursive: true });
  try {
    const info = await lstat(state);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The local state path must be a real directory.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' && !create) return false;
    throw error;
  }
}

async function listIds() {
  if (!(await checkState())) return [];
  const filenames = await readdir(state);
  return filenames.filter((filename) => filename.endsWith('.json')).map((filename) => filename.slice(0, -5));
}

async function readEntry(id) {
  const filename = join(state, `${id}.json`);
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1200000) {
      throw new Error('Invalid local record file.');
    }
    const record = JSON.parse(await readFile(filename, 'utf8'));
    if (record.id !== id) throw new Error('Record ID mismatch.');
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function getRecord(id) {
  if (!idPattern.test(id)) throw new Error('Invalid record ID.');
  const record = await checkState() ? await readEntry(id) : null;
  if (!record) throw new Error('Record not found.');
  return record;
}

// Publish a complete immutable file. A repeated adoption returns the original record.
async function insertRecord(record) {
  await checkState(true);
  const temp = join(state, `temp-${randomUUID()}`);
  const filename = join(state, `${record.id}.json`);
  try {
    await writeFile(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await link(temp, filename);
    return record;
  } catch (error) {
    if (error.code === 'EEXIST' && record.kind === 'adopted') return getRecord(record.id);
    throw error;
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function readHistory(kind) {
  if (!(await checkState())) return { records: [], skipped_records: 0 };
  const records = [];
  let skipped = 0;
  for (const filename of await readdir(state)) {
    if (!filename.endsWith('.json')) continue;
    const id = filename.slice(0, -5);
    if (!idPattern.test(id) || (kind !== 'all' && !id.startsWith(`${kind}-`))) continue;
    try {
      const record = await readEntry(id);
      if (!record || typeof record.date !== 'string' || typeof record.created_at !== 'string') {
        throw new Error('Invalid course record.');
      }
      records.push(record);
    } catch {
      skipped += 1;
    }
  }
  records.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
    || b.id.localeCompare(a.id));
  return { records, skipped_records: skipped };
}

function summarize(record) {
  const { id, kind, date, topic, growth_step, next_question, created_at, phase_id, task_id,
    adoption_scope, lesson_scope } = record;
  return { id, kind, date, topic, growth_step, next_question, created_at, phase_id, task_id,
    adoption_scope, lesson_scope };
}

async function getStoredAgenda() {
  if (!(await checkState())) return null;
  const files = (await readdir(state)).filter((filename) => filename.endsWith('.json'));
  const latest = files.map((filename) => filename.slice(0, -5))
    .filter((id) => agendaPattern.test(id)).sort().at(-1);
  if (!latest) return null;
  const agenda = await readEntry(latest);
  if (!agenda || agenda.revision !== Number(latest.slice(-6)) || agenda.kind !== 'agenda') {
    throw new Error('Invalid latest agenda record.');
  }
  validate(agenda.phase, phaseSchema);
  if (!Array.isArray(agenda.tasks)) throw new Error('Invalid agenda tasks.');
  for (const task of agenda.tasks) validate(task, taskSchema);
  return agenda;
}

function matchesTask(saved, current) {
  return Boolean(saved && current && Object.keys(taskSchema.properties)
    .every((key) => saved[key] === current[key]));
}

function completionKey(adoption) {
  const subject = adoption.task_id ? [adoption.phase_id,
    ...Object.keys(taskSchema.properties).map((key) => adoption.planned_task[key] ?? null)] : [adoption.id];
  const digest = createHash('sha256').update(JSON.stringify(subject)).digest('hex');
  return `lesson-completion-${digest}`;
}

async function readCompletedLessons() {
  const completionIds = latestSnapshotIds(await listIds(), completionPattern, () => true);
  const history = await readHistory('adopted');
  const byId = new Map(history.records.map((record) => [record.id, record]));
  const completed = new Map();
  for (const id of completionIds) {
    try {
      const entry = await completionStore.readSnapshot(id, 'lesson_completion');
      const adoption = byId.get(entry.adopted_record_id);
      if (!adoption || completionKey(adoption) !== id.slice(0, -7)) {
        throw new Error('Invalid lesson completion record.');
      }
      completed.set(completionKey(adoption), adoption.id);
    } catch {
      history.skipped_records += 1;
    }
  }
  const completedIds = new Set(completed.values());
  return { ...history, records: history.records.filter((record) => completedIds.has(record.id)
    || (record.adoption_scope === undefined && (!record.planned_task || !completed.has(completionKey(record))))) };
}

async function latestCompletion(key) {
  const [id] = latestSnapshotIds(await listIds(), completionPattern, ([, prefix]) => prefix === key);
  return id ? completionStore.readSnapshot(id, 'lesson_completion') : null;
}

async function getAgendaView(agenda) {
  const history = await readCompletedLessons();
  const tasks = (agenda?.tasks ?? []).map((task) => {
    const adopted = history.records.find((record) => record.phase_id === agenda.phase.id
      && record.task_id === task.id && matchesTask(record.planned_task, task));
    return { ...task, status: adopted ? 'adopted' : 'pending', adopted_record_id: adopted?.id };
  });
  return {
    revision: agenda?.revision ?? 0, phase: agenda?.phase ?? null, source: agenda?.source,
    tasks, next_task: tasks.find((task) => task.status === 'pending') ?? null,
    latest_adopted_lesson: history.records[0] ? summarize(history.records[0]) : null,
    skipped_records: history.skipped_records,
  };
}

async function saveDraft(args, { id = `draft-${randomUUID()}`, mobile_handoff } = {}) {
  validateDate(args.date);
  if (Boolean(args.phase_id) !== Boolean(args.task_id)) throw new Error('Provide phase_id and task_id together.');
  function reusedDraft(record) {
    if (record.kind !== 'draft' || record.mobile_handoff?.fingerprint !== mobile_handoff.fingerprint
      || record.source !== args.source || record.phase_id !== args.phase_id || record.task_id !== args.task_id) {
      throw new Error('Existing draft does not match this handoff.');
    }
    return { id: record.id, kind: record.kind, reused: true };
  }
  if (mobile_handoff && await checkState()) {
    const existing = await readEntry(id);
    if (existing) return reusedDraft(existing);
  }
  let plannedTask;
  if (args.task_id) {
    const agenda = await getStoredAgenda();
    if (agenda?.phase.id !== args.phase_id) throw new Error('Draft does not match the active phase.');
    plannedTask = agenda.tasks.find((task) => task.id === args.task_id);
    if (!plannedTask) throw new Error('Draft task is missing from the approved agenda.');
    if (plannedTask.scheduled_date && plannedTask.scheduled_date !== args.date) {
      throw new Error('Draft date does not match the approved task date.');
    }
  }
  const record = { ...args, id, kind: 'draft', created_at: new Date().toISOString(),
    planned_task: plannedTask, mobile_handoff };
  try {
    await insertRecord(record);
  } catch (error) {
    if (error.code === 'EEXIST' && mobile_handoff) return reusedDraft(await getRecord(id));
    throw error;
  }
  return { id: record.id, kind: record.kind, ...(mobile_handoff ? { reused: false } : {}) };
}

const handlers = {
  ...lessonKit.handlers,
  ...speechFormat.handlers,
  ...whatsappVoice.handlers,
  ...newsBroadcast.handlers,
  ...dayOperations.handlers,
  ...mobileHandoff.handlers,
  ...memberCast.handlers,
  ...sceneCheckpoints.handlers,
  async append_gold_sample({ date, body }) {
    validateDate(date);
    const lines = body.trim().split(transcriptBreak);
    const blocks = getBlocks(lines.join('\n'));
    if (blocks[0]?.line !== 1 || blocks.some((block) => !block.lines.join('\n').trim())) {
      throw new Error('Provide the supplied dialogue with speaker labels and nonempty lines.');
    }
    const formatted = blocks.map((block) => block.label + '\n' + block.lines.join('\n').trim()).join('\n');
    const id = createHash('sha256').update(date + '\n' + formatted).digest('hex').slice(0, 16);
    const file = resolve(project, 'reference', 'gold-samples.md');
    const marker = '<!-- sample:' + id + ' -->';
    if (!(await lstat(file)).isFile()) throw new Error('Gold sample library must be a regular file.');
    const before = await readFile(file, 'utf8');
    if (!before.includes(marker)) {
      const longestFence = Math.max(2, ...(formatted.match(/`+/gu) ?? []).map((run) => run.length));
      const fence = '`'.repeat(longestFence + 1);
      await appendFile(file, '\n\n' + marker + '\n## ' + date + ' · 用户提供样稿\n\n'
        + '用途：语感参考。\n\n' + fence + 'text\n' + formatted + '\n' + fence + '\n', { flag: 'a', encoding: 'utf8' });
    }
    if (!(await readFile(file, 'utf8')).includes(marker)) throw new Error('Gold sample could not be read back.');
    return { id, path: 'reference/gold-samples.md', messages: blocks.length, unchanged: before.includes(marker) };
  },
  ...localEdit.handlers,
  ...marketOperations.handlers,
  async list_records({ kind = 'adopted', limit = 8 }) {
    const history = await readHistory(kind);
    return { ...history, records: history.records.slice(0, limit).map(summarize) };
  },
  async read_record({ id, view = 'full' }) {
    const record = await getRecord(id);
    if (view === 'full') return record;
    const { body, ...details } = record;
    const bodyTail = typeof body === 'string' ? Array.from(body).slice(-3000).join('') : '';
    return { ...details, body_tail: bodyTail, more_before: typeof body === 'string' && bodyTail.length < body.length };
  },
  async get_agenda() {
    return getAgendaView(await getStoredAgenda());
  },
  async save_agenda({ expected_revision, phase, source, tasks }) {
    const current = await getStoredAgenda();
    if ((current?.revision ?? 0) !== expected_revision) throw new Error('Agenda revision changed. Read get_agenda again.');
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error('Task IDs must be unique.');
    let previousDate = '';
    for (const task of tasks) {
      if (!task.scheduled_date) continue;
      validateDate(task.scheduled_date);
      if (task.scheduled_date < previousDate) throw new Error('Dated tasks must follow their calendar order.');
      previousDate = task.scheduled_date;
    }
    const revision = expected_revision + 1;
    const id = `agenda-${String(revision).padStart(6, '0')}`;
    const entry = { id, kind: 'agenda', revision, phase, source, tasks, created_at: new Date().toISOString() };
    try {
      await insertRecord(entry);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Agenda revision changed. Read get_agenda again.');
      throw error;
    }
    return getAgendaView(entry);
  },
  save_draft: saveDraft,
  async record_adoption({ id, approval }) {
    if (!idPattern.test(id) || !id.startsWith('draft-')) throw new Error('Only a draft ID can be adopted.');
    const adoptedId = id.replace(/^draft-/, 'adopted-');
    if (await checkState() && await readEntry(adoptedId)) return { id: adoptedId, kind: 'adopted' };
    const draft = await getRecord(id);
    if (draft.task_id) {
      const agenda = await getAgendaView(await getStoredAgenda());
      const task = agenda.tasks.find((entry) => entry.id === draft.task_id);
      if (agenda.phase?.id !== draft.phase_id || !matchesTask(draft.planned_task, task)) {
        throw new Error('The approved task changed after drafting. Review the current task before adopting.');
      }
      if (agenda.skipped_records) throw new Error('Some adoption records could not be read. Check history before adoption.');
      if (task.status === 'pending' && agenda.next_task?.id !== task.id) {
        throw new Error('An earlier task is pending. Adopt it or revise the agenda before adopting this task.');
      }
    }
    const record = await insertRecord({ ...draft, id: adoptedId,
      kind: 'adopted', adoption_scope: 'content', draft_id: id, approval, created_at: new Date().toISOString() });
    return { id: record.id, kind: record.kind };
  },
  async complete_lesson({ id, confirmation, supersedes }) {
    const adoption = await getRecord(id);
    if (adoption.kind !== 'adopted' || (adoption.adoption_scope !== undefined && adoption.lesson_scope !== 'full_lesson')) {
      throw new Error('Save and adopt the full_lesson version before confirming lesson completion.');
    }
    if (supersedes && !adoption.task_id) throw new Error('A replacement requires a task on the current agenda.');
    const result = { status: 'completed', task_id: adoption.task_id ?? null, adopted_record_id: id };
    const key = completionKey(adoption);
    const current = await latestCompletion(key);
    if (adoption.task_id) {
      const agenda = await getAgendaView(await getStoredAgenda());
      const task = agenda.tasks.find((entry) => entry.id === adoption.task_id);
      if (agenda.phase?.id !== adoption.phase_id || !matchesTask(adoption.planned_task, task)) {
        throw new Error('The approved task has changed. Read the current agenda before confirming completion.');
      }
      if (agenda.skipped_records) throw new Error('Some lesson records could not be read. Check history before completing a task.');
      if (task.status === 'adopted') {
        if (task.adopted_record_id === id) return result;
        if (supersedes !== task.adopted_record_id) {
          throw new Error(`Confirm the replacement and supply the current completed version as supersedes: ${task.adopted_record_id}.`);
        }
      } else if (supersedes || agenda.next_task?.id !== task.id) {
        throw new Error('The requested replacement or task order does not match the current agenda.');
      }
    }
    if (current?.adopted_record_id === id) return result;
    try {
      await completionStore.saveSnapshot(key, 'lesson_completion', current?.revision ?? 0,
        { adopted_record_id: id, confirmation, supersedes });
    } catch (error) {
      if ((await latestCompletion(key))?.adopted_record_id !== id) throw error;
    }
    return result;
  },
};

const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const reply = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const success = (id, result) => reply({ id, result });
const failure = (id, code, message) => reply({ id, error: { code, message } });

async function receive(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return failure(null, -32700, 'Invalid JSON.');
  }
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return failure(request?.id ?? null, -32600, 'Invalid request.');
  }
  const { id, method, params } = request;
  if (id === undefined) return;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const protocolVersion = protocolVersions.includes(requested) ? requested : protocolVersions[0];
    return success(id, { protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'westcott-state', version: '1.7.2' } });
  }
  if (method === 'ping') return success(id, {});
  if (method === 'tools/list') return success(id, { tools: definitions });
  if (method !== 'tools/call') return failure(id, -32601, 'Unknown method.');

  const definition = definitions.find((tool) => tool.name === params?.name);
  if (!definition) return failure(id, -32602, 'Unknown tool.');
  try {
    const args = params.arguments ?? {};
    validate(args, definition.inputSchema);
    const result = await handlers[definition.name](args);
    return success(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (error) {
    return success(id, { isError: true, content: [{ type: 'text', text: error.message }] });
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (line.trim()) await receive(line);
}
