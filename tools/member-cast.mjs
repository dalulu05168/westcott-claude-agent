import { createRevisionStore, latestSnapshotIds, revisionField } from './state-revisions.mjs';
import { readFile } from 'node:fs/promises';
import { defaultCastLimit } from './scene-rules.mjs';

const memberIds = '(0[1-9]|[1-9][0-9])';
const profilePattern = new RegExp(`^cast-profile-${memberIds}-([0-9]{6})$`);
const activityPattern = new RegExp(`^cast-activity-${memberIds}-(script|live)-([a-z0-9][a-z0-9-]{0,47})-([0-9]{6})$`);
const sessions = ['morning', 'afternoon', 'evening'];
const scopes = ['script', 'live'];
const availability = ['active', 'paused', 'archived'];
const learnerStages = ['newcomer', 'participating', 'applying', 'independent'];
const speakingMoves = ['basic_question', 'focused_question', 'observation', 'condition', 'comparison', 'revision', 'explanation'];
const previousCastLimit = 42;
const choice = (values) => ({ type: 'string', enum: values, maxLength: 40 });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const readOnly = { readOnlyHint: true, openWorldHint: false };
const localWrite = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const staff = [
  { name: 'David Miller', role: '先生 / 股票执行负责人', label: 'David先生' },
  { name: 'Gabriela Ion', role: '女投资顾问', label: 'Gabriela' },
  { name: 'Ana Maria', role: '男资讯助理', label: '资讯助理' },
];

const scriptRoles = [
  { id: 'intuitive_retail', label: '直觉型散户', move: '说出眼前的直观反应，再留下一个具体疑问。' },
  { id: 'rule_explainer', label: '规则型成员', move: '在日常交流中简短解释已核实的规则或术语，留下主课待答的问题。' },
  { id: 'detail_recaller', label: '细节型成员', move: '晚课翻出白天已核对的具体原话或悬念，请 David 接住其中一个细节。' },
];

async function readRoster() {
  const data = JSON.parse(await readFile(new URL('../reference/legacy-member-roster.json', import.meta.url), 'utf8'));
  if (data.status !== 'USER_FINAL_65_IDENTITY_FIELDS' || data.count !== 65 || data.people?.length !== 65) {
    throw new Error('The legacy roster must contain the 65 confirmed identities.');
  }
  const people = data.people.map((row, index) => {
    const number = index + 1;
    if (row.id !== String(number).padStart(2, '0') || !row.name?.trim() || !['男', '女'].includes(row.gender)) {
      throw new Error(`Invalid identity in the legacy roster at row ${number}.`);
    }
    return {
      member_id: row.id, label: `${row.id}${row.gender}`, name: row.name, nick: row.nick,
      display_name: row.name.trim().split(/\s+/)[0], gender: row.gender,
      availability: number <= defaultCastLimit ? 'active' : 'archived', source: data.version, revision: 0,
    };
  });
  return { version: data.version, people };
}

function findIdentity(roster, id) {
  const identity = roster.people.find((member) => member.member_id === id);
  if (!identity) throw new Error(`Member ${id} is outside the confirmed legacy roster.`);
  return identity;
}

function compareScene(a, b) {
  return a.date.localeCompare(b.date) || sessions.indexOf(a.session) - sessions.indexOf(b.session);
}

function growthContext(rows) {
  const appearances = rows.filter((row) => row.activity_type === 'appearance');
  const observedScenes = new Map();
  const sceneMoves = new Map();
  for (const row of appearances) {
    const key = row.date + '/' + row.session;
    if (!observedScenes.has(key)) observedScenes.set(key, { date: row.date, session: row.session });
    if (!sceneMoves.has(key) && row.speaking_move) sceneMoves.set(key, row.speaking_move);
  }
  const newestStage = rows.find((row) => row.activity_type === 'progress' && row.learner_stage);
  const recentMoves = [...observedScenes.keys()].slice(0, 3).map((key) => sceneMoves.get(key) ?? null);
  return {
    current_stage: newestStage?.learner_stage ?? null,
    stage_source: newestStage ? { date: newestStage.date, session: newestStage.session, summary: newestStage.summary,
      source: newestStage.source } : null,
    distinct_appearance_scenes: observedScenes.size,
    first_recorded_appearance: [...observedScenes.values()].at(-1) ?? null,
    recent_speaking_moves: recentMoves,
    review_repeated_basic_questions: recentMoves[0] === 'basic_question' && recentMoves[1] === 'basic_question',
  };
}

export function createMemberCast({ text, schema, dateField, validateDate, listIds, readEntry, insertRecord }) {
  const { readSnapshot, saveSnapshot } = createRevisionStore({ listIds, readEntry, insertRecord });
  const memberId = { ...text(2), pattern: `^${memberIds}$` };
  const activityKey = { ...text(48), pattern: '^[a-z0-9][a-z0-9-]{0,47}$' };
  const definitions = [
    {
      name: 'get_cast_context',
      description: 'Read member profiles and evidence-based progress as of a Bucharest scene. Script scope also lists optional writing roles for the scene. Use selection for a short cast list, focused with selected IDs for writing, and full for detailed history.',
      inputSchema: schema({
        as_of: dateField, through_session: choice(sessions), scope: choice(scopes),
        member_ids: array(memberId, 1, 65), include_inactive: { type: 'boolean' }, discussion_group: text(40),
        detail: choice(['selection', 'focused', 'full']),
      }, ['as_of']),
      annotations: readOnly,
    },
    {
      name: 'save_member_profile',
      description: 'Version a confirmed writing profile under its fixed legacy identity. Profile status does not override the scene casting rules.',
      inputSchema: schema({
        member_id: memberId, expected_revision: revisionField, label: text(40),
        availability: choice(availability), voice: text(1000), source: text(1200), sample_lines: array(text(350), 0, 4),
        archive_activation_confirmed: { type: 'boolean' }, discussion_group: text(40),
      }, ['member_id', 'expected_revision', 'label', 'availability', 'voice', 'source']),
      annotations: localWrite,
    },
    {
      name: 'save_member_activity',
      description: 'Record an adopted-script or confirmed feedback appearance, evidenced learning progress, or question. Record speaking_move on appearance and learner_stage on progress. Keep script and live separate.',
      inputSchema: schema({
        member_id: memberId, scope: choice(scopes), key: activityKey, expected_revision: revisionField,
        date: dateField, session: choice(sessions), activity_type: choice(['appearance', 'progress', 'question']),
        summary: text(1000), source: text(1200), status: choice(['open', 'resolved']),
        learner_stage: choice(learnerStages), speaking_move: choice(speakingMoves),
      }, ['member_id', 'scope', 'key', 'expected_revision', 'date', 'session', 'activity_type', 'summary', 'source']),
      annotations: localWrite,
    },
  ];

  async function getProfiles(ids, memberList) {
    const profileIds = latestSnapshotIds(ids, profilePattern, ([, member]) => !memberList || memberList.has(member));
    return Promise.all(profileIds.map((id) => readSnapshot(id, 'cast_profile')));
  }

  async function getActivityAsOf(ids, members, scope, scene) {
    const activityIds = ids.filter((id) => {
      const match = activityPattern.exec(id);
      return match && members.has(match[1]) && match[2] === scope;
    }).sort().reverse();
    const latest = new Map();
    const firstRevisions = new Map();
    for (const id of activityIds) {
      const key = id.slice(0, -7);
      if (!firstRevisions.has(key)) firstRevisions.set(key, Number(id.slice(-6)));
      if (latest.has(key)) continue;
      const row = await readSnapshot(id, 'cast_activity');
      const member = members.get(row.member_id);
      if (!member || (row.identity_label && row.identity_label !== member.label)
        || (!row.identity_label && member.legacy_activity_review_required)) continue;
      if (compareScene(row, scene) <= 0) latest.set(key, row);
    }
    const activity = [...latest.values()].sort((a, b) => compareScene(b, a)
      || b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id));
    return { activity, firstRevisions };
  }

  const handlers = {
    async get_cast_context({ as_of, through_session = 'evening', scope = 'script',
      member_ids, include_inactive = false, discussion_group, detail = 'full' }) {
      validateDate(as_of);
      const ids = await listIds();
      const requested = member_ids ? new Set(member_ids) : null;
      const roster = await readRoster();
      const stored = new Map((await getProfiles(ids, requested)).map((profile) => [profile.member_id, profile]));
      const conflicts = [];
      const profiles = roster.people.filter((identity) => !requested || requested.has(identity.member_id)).map((identity) => {
        const local = stored.get(identity.member_id);
        if (!local) return identity;
        if (local.label !== identity.label) {
          conflicts.push({ member_id: identity.member_id, roster_label: identity.label, local_label: local.label,
            local_revision: local.revision });
          return { ...identity, revision: local.revision, legacy_activity_review_required: true };
        }
        const priorDefaultArchive = Number(identity.member_id) > previousCastLimit
          && identity.availability === 'active' && local.availability === 'archived' && !local.cast_policy_limit;
        const releaseAllowed = identity.availability !== 'archived' || local.archive_activation_confirmed;
        let status = local.availability;
        if (priorDefaultArchive) status = 'active';
        if (status === 'active' && !releaseAllowed) status = 'archived';
        return { ...identity, ...local, availability: status, label: identity.label, name: identity.name,
          gender: identity.gender, nick: identity.nick, display_name: identity.display_name };
      });
      const known = new Set(roster.people.map((profile) => profile.member_id));
      const visible = profiles.filter((profile) => include_inactive || requested || profile.availability === 'active')
        .filter((profile) => !discussion_group || profile.discussion_group === discussion_group.trim())
        .sort((a, b) => a.member_id.localeCompare(b.member_id));
      const metadata = { as_of, through_session, scope, roster_version: roster.version, staff,
        roster_count: roster.people.length, default_cast_limit: defaultCastLimit, identity_conflicts: conflicts,
        ...(scope === 'script' ? { script_roles: scriptRoles } : {}),
        missing_member_ids: requested ? [...requested].filter((id) => !known.has(id)) : [] };
      if (detail === 'selection') {
        const members = visible.map(({ member_id, label, display_name, availability, discussion_group }) =>
          ({ profile: { member_id, label, display_name, availability, discussion_group } }));
        return { ...metadata, members };
      }
      const members = new Map(visible.map((profile) => [profile.member_id, profile]));
      const { activity, firstRevisions } = await getActivityAsOf(ids, members, scope, { date: as_of, session: through_session });
      const context = visible.map((profile) => {
        const rows = activity.filter((row) => row.member_id === profile.member_id);
        let questions = rows.filter((row) => row.activity_type === 'question');
        const questionCount = questions.length;
        if (detail === 'focused') {
          questions = [...questions.filter((row) => row.status === 'open').slice(0, 3),
            ...questions.filter((row) => row.status === 'resolved').slice(0, 1)];
          profile = { ...profile, sample_lines: profile.sample_lines?.slice(0, 2) };
        }
        return {
          profile,
          last_appearance: rows.find((row) => row.activity_type === 'appearance') ?? null,
          latest_progress: rows.find((row) => row.activity_type === 'progress') ?? null,
          growth: growthContext(rows),
          questions: questions.map((row) => ({
            ...row, latest_revision: firstRevisions.get(row.id.slice(0, -7)),
          })),
          ...(detail === 'focused' ? { omitted_questions: questionCount - questions.length } : {}),
        };
      });
      return { ...metadata, members: context };
    },

    async save_member_profile({ expected_revision, ...data }) {
      const identity = findIdentity(await readRoster(), data.member_id);
      if (data.label !== identity.label) {
        throw new Error(`Use the confirmed identifier ${identity.label} for this member.`);
      }
      if (identity.availability === 'archived' && data.availability === 'active' && !data.archive_activation_confirmed) {
        throw new Error('This member is archived. Obtain explicit authorization before activating the member.');
      }
      const [previous] = await getProfiles(await listIds(), new Set([data.member_id]));
      const needsReview = Boolean(previous && (previous.label !== identity.label || previous.legacy_activity_review_required));
      const discussion_group = data.discussion_group?.trim()
        ?? (previous?.label === identity.label ? previous.discussion_group : undefined);
      return saveSnapshot(`cast-profile-${data.member_id}`, 'cast_profile', expected_revision,
        { ...data, discussion_group, cast_policy_limit: defaultCastLimit, legacy_activity_review_required: needsReview || undefined });
    },

    async save_member_activity({ expected_revision, ...data }) {
      validateDate(data.date);
      if ((data.activity_type === 'question') !== (data.status !== undefined)) {
        throw new Error('Use open or resolved status on questions only.');
      }
      if (data.learner_stage && data.activity_type !== 'progress') {
        throw new Error('Record learner_stage on evidence-backed progress only.');
      }
      if (data.speaking_move && data.activity_type !== 'appearance') {
        throw new Error('Record speaking_move on an appearance only.');
      }
      const identity = findIdentity(await readRoster(), data.member_id);
      const prefix = `cast-activity-${data.member_id}-${data.scope}-${data.key}`;
      if (expected_revision) {
        const previous = await readSnapshot(`${prefix}-${String(expected_revision).padStart(6, '0')}`, 'cast_activity');
        if (previous.activity_type !== data.activity_type || compareScene(data, previous) < 0) {
          throw new Error('Keep the same activity type and use the same or a later scene when updating an item.');
        }
        data.learner_stage ??= previous.learner_stage;
        data.speaking_move ??= previous.speaking_move;
      }
      return saveSnapshot(prefix, 'cast_activity', expected_revision, { ...data, identity_label: identity.label });
    },
  };
  return { definitions, handlers };
}
