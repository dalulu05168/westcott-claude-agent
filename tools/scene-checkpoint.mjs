import { getBlocks, pictureFooter, transcriptBreak } from './speech-format.mjs';
import { createRevisionStore, latestSnapshotIds, revisionField } from './state-revisions.mjs';

const choice = (values) => ({ type: 'string', enum: values, maxLength: 30 });
export const sceneSession = choice(['morning', 'afternoon', 'evening']);
const mobileSessions = { 上午: 'morning', 下午: 'afternoon', 晚间: 'evening' };
const timeZone = 'Europe/Bucharest';
const snapshotPattern = /^scene-(\d{4}-\d{2}-\d{2})-(morning|afternoon|evening)-(\d{6})$/;
const bodyLimit = 120000;
const snapshotLimit = 1150000;

function inspectBody(body) {
  const blocks = getBlocks(body);
  if (!blocks.length || blocks.some((block) => !block.lines.some((line) => line.trim()))) {
    throw new Error('A scene checkpoint needs labelled messages with nonempty text.');
  }
  const lines = body.split(transcriptBreak);
  const lastBlock = blocks.at(-1);
  return {
    confirmed_count: blocks.length,
    last_speaker: lastBlock.label,
    last_line: lines.findLast((line) => line.trim()),
    last_spoken_line: lastBlock.lines.findLast((line) => line.trim() && !pictureFooter.test(line.trim())) ?? null,
    tail: lines.slice(blocks.at(-Math.min(3, blocks.length)).line - 1).join('\n').trimEnd().slice(-4000),
  };
}

function trackView(track, includeBody) {
  if (!track) return null;
  const { body, included_adopted_ids, ...details } = track;
  const transcript = inspectBody(body);
  return { ...details, ...transcript,
    completed_count: details.coverage === 'from_start' ? transcript.confirmed_count : null,
    ...(includeBody ? { body } : {}) };
}

export function createSceneCheckpointTools({ text, schema, dateField, validateDate, listIds, readEntry, insertRecord, getRecord, getHandoff }) {
  const { readSnapshot, saveSnapshot } = createRevisionStore({ listIds, readEntry, insertRecord });
  const dateAndSession = { date: dateField, session: sceneSession };
  const definitions = [
    {
      name: 'get_scene_checkpoint',
      description: 'Restore a Bucharest scene. final is the reviewed script handoff, separate from user-adopted and actually sent text. Includes exact hooks, news and stopping boundary when available.',
      inputSchema: schema({ ...dateAndSession, include_body: { type: 'boolean' } }, ['date', 'session']),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'save_scene_checkpoint',
      description: 'Save confirmed adopted or sent text, or save a reviewed daytime script automatically as track final. final replaces only its own track and does not adopt or publish.',
      inputSchema: schema({
        ...dateAndSession, expected_revision: revisionField, track: choice(['adopted', 'sent', 'final']),
        mode: choice(['replace', 'append']), coverage: choice(['from_start', 'partial']),
        body: text(bodyLimit), adopted_record_id: text(44),
        status: choice(['in_progress', 'waiting', 'closed']), node: text(300),
        stop_after: text(1000), next_step: text(1000),
        unresolved: { type: 'array', items: text(500), minItems: 0, maxItems: 20 },
        source: schema({ ref: text(1000), tab: text(300), revision: text(300) }, ['ref']),
        confirmation: text(1000),
        summary: text(1500),
        planned_news: { type: 'array', items: text(500), maxItems: 20 },
        hooks: { type: 'array', maxItems: 12, items: schema({
          speaker: text(120), quote: text(500), target: choice(['afternoon', 'evening']), question: text(500),
        }, ['speaker', 'quote', 'target', 'question']) },
      }, ['date', 'session', 'expected_revision', 'track', 'status', 'node', 'unresolved', 'source', 'confirmation']),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
  ];

  async function latest(date, session) {
    validateDate(date);
    const [id] = latestSnapshotIds(await listIds(), snapshotPattern, ([, day, slot]) => day === date && slot === session);
    return id ? readSnapshot(id, 'scene_checkpoint') : { date, session, revision: 0, adopted: null, sent: null };
  }

  function view({ date, session, revision, adopted, sent, final }, includeBody = false) {
    return { date, session, timezone: timeZone, revision,
      adopted: trackView(adopted, includeBody), sent: trackView(sent, includeBody), final: trackView(final, includeBody) };
  }

  const handlers = {
    async get_scene_checkpoint({ date, session, include_body }) {
      return view(await latest(date, session), include_body);
    },
    async save_scene_checkpoint({ date, session, expected_revision, track, mode = 'replace',
      coverage, body, adopted_record_id, status, node, stop_after, next_step, unresolved, source, confirmation,
      summary, hooks, planned_news }) {
      const current = await latest(date, session);
      if (current.revision !== expected_revision) throw new Error('Revision changed. Read the latest scene checkpoint first.');
      if (status === 'waiting' && !stop_after) throw new Error('A waiting scene needs an explicit stopping boundary.');
      let handoff;
      if (track === 'final') {
        if (session === 'evening' || mode !== 'replace' || !body || adopted_record_id || !summary?.trim() || !hooks || !planned_news) {
          throw new Error('A daytime final checkpoint requires a replacement script, summary, hooks and planned news.');
        }
        const blocks = getBlocks(body);
        // 角色标记带不带冒号都接受；报错写清是哪条钩子、错在哪，避免反复盲试。
        const normalize = (value) => value.split(transcriptBreak).join('\n').trim();
        const bareLabel = (label) => label.trim().replace(/[：:]$/u, '');
        const members = blocks.filter((block) => block.role === 'member');
        for (const [index, hook] of hooks.entries()) {
          const where = `第 ${index + 1} 条钩子（${hook.speaker}）`;
          if (session === 'afternoon' && hook.target !== 'evening') {
            throw new Error(`${where}：下午场的钩子只能留给晚课，target 填 evening。`);
          }
          const own = members.filter((block) => bareLabel(block.label) === bareLabel(hook.speaker));
          if (!own.length) {
            const labels = [...new Set(members.map((block) => bareLabel(block.label)))].join('、');
            throw new Error(`${where}：正文里没有这个成员。speaker 填正文里的角色标记，可选：${labels}。`);
          }
          if (!hook.quote.trim() || !own.some((block) => normalize(block.lines.join('\n')) === normalize(hook.quote))) {
            const said = own.map((block) => `「${normalize(block.lines.join('\n'))}」`).join(' ');
            throw new Error(`${where}：quote 须逐字照抄该成员的一整条发言。他在正文里的原话：${said}`);
          }
        }
        const { today } = await getHandoff({ date, through_session: session, lookback_days: 0 });
        const published_news = today.filter((item) => item.session === session
          && item.category === 'published' && item.news_published_at);
        handoff = { summary, hooks, planned_news, published_news };
      } else if (summary !== undefined || hooks !== undefined || planned_news !== undefined) {
        throw new Error('Automatic handoff fields belong to the final track.');
      }
      if (body && adopted_record_id) throw new Error('Use either confirmed text or an adopted record ID.');
      if (adopted_record_id) {
        const record = await getRecord(adopted_record_id);
        const recordSession = record.session ?? mobileSessions[record.mobile_handoff?.session];
        if (record.kind !== 'adopted' || record.date !== date || (recordSession && recordSession !== session)) {
          throw new Error('Use an adopted record from the same date and scene.');
        }
        body = record.body;
      }
      const previous = current[track];
      if (mode === 'append' && (!previous || !body)) {
        throw new Error('Appending requires an existing checkpoint on this track and new confirmed text.');
      }
      if (!body && !previous) throw new Error('The first checkpoint on this track needs confirmed text.');
      const sameSource = previous?.source.ref === source.ref && previous.source.tab === source.tab;
      if (sameSource && (mode === 'append' || !body)) {
        if (source.revision && source.revision !== previous.source.revision) {
          throw new Error('The source revision changed. Replace the checkpoint with the verified current transcript.');
        }
        source = { ...source, revision: previous.source.revision };
      }
      if ((mode === 'append' || !body) && coverage && coverage !== previous.coverage) {
        throw new Error('To change transcript coverage, replace it with verified text.');
      }
      const transcriptCoverage = mode === 'append' || !body ? previous.coverage : (coverage ?? 'partial');
      const knownIds = previous?.included_adopted_ids ?? (previous?.adopted_record_id ? [previous.adopted_record_id] : []);
      if (mode === 'append' && adopted_record_id && knownIds.includes(adopted_record_id)) {
        return { ...view(current), unchanged: true };
      }
      const includedAdoptedIds = new Set(knownIds);
      if (adopted_record_id) includedAdoptedIds.add(adopted_record_id);
      if (body) inspectBody(body);
      else adopted_record_id = previous.adopted_record_id;
      if (mode === 'append') body = `${previous.body}\n\n${body}`;
      body ??= previous.body;
      if (body.length > bodyLimit) throw new Error('The confirmed scene transcript is too long.');
      const snapshot = { date, session, adopted: current.adopted, sent: current.sent, final: current.final ?? null,
        [track]: { body, coverage: transcriptCoverage, status, node, stop_after, next_step,
          unresolved, source, confirmation, adopted_record_id, included_adopted_ids: [...includedAdoptedIds], ...handoff } };
      if (Buffer.byteLength(JSON.stringify(snapshot, null, 2)) > snapshotLimit) {
        throw new Error('The scene checkpoint is too large to store.');
      }
      return view(await saveSnapshot(`scene-${date}-${session}`, 'scene_checkpoint', expected_revision, snapshot));
    },
  };
  return { definitions, handlers };
}
