import { createRevisionStore, latestSnapshotIds, revisionField } from './state-revisions.mjs';
import { validateMarketTimestamp } from './market-time.mjs';
import { eventImageCheckSchema, eventImageIssue, validEventImage } from './news-image.mjs';

const sessions = ['morning', 'afternoon', 'evening'];
const markets = ['bvb', 'romania', 'us', 'international'];
const marketSessions = ['previous_close', 'futures', 'premarket', 'open', 'intraday', 'close', 'afterhours', 'news'];
const checkStatuses = ['verified', 'conflicting', 'unverified'];
const handoffCategories = ['published', 'open_question', 'quiz', 'exercise', 'follow_up'];
const handoffPattern = /^handoff-(\d{4}-\d{2}-\d{2})-(morning|afternoon|evening)-(\d{6})$/;
const factPattern = /^fact-(\d{4}-\d{2}-\d{2})-(bvb|romania|us|international)-(previous_close|futures|premarket|open|intraday|close|afterhours|news)-([a-z0-9][a-z0-9-]{0,47})-(\d{6})$/;
const choice = (values) => ({ type: 'string', enum: values, maxLength: 50 });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });

function dateBefore(date, offset) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

export function createDayOperations({ text, schema, dateField, validateDate, listIds, readEntry, insertRecord }) {
  const { readSnapshot, saveSnapshot } = createRevisionStore({ listIds, readEntry, insertRecord });
  const topicKey = { ...text(48), pattern: '^[a-z0-9][a-z0-9-]{0,47}$' };
  const handoffKey = { ...text(59), pattern: '^\\d{4}-\\d{2}-\\d{2}-[a-z0-9][a-z0-9-]{0,47}$' };
  const timestamp = text(35);
  const itemSchema = schema({
    key: handoffKey, category: choice(handoffCategories), summary: text(1200),
    status: choice(['open', 'completed']), source: text(1000), news_published_at: timestamp,
  }, ['key', 'category', 'summary', 'status', 'source']);
  const sourceSchema = schema({
    publisher: text(300), url: text(2000), retrieved_at: timestamp, published_at: timestamp,
  }, ['publisher', 'url', 'retrieved_at']);
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const localWrite = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const definitions = [
    {
      name: 'get_handoff',
      description: 'Read confirmed morning, afternoon and evening handoff items and older open items. Use the Bucharest date.',
      inputSchema: schema({
        date: dateField, through_session: choice(sessions), lookback_days: integer(0, 14),
      }, ['date']),
      annotations: readOnly,
    },
    {
      name: 'save_handoff',
      description: 'Save one confirmed session handoff snapshot, including updates on existing item keys. Read its revision from get_handoff first; a snapshot replaces that session view and preserves earlier revisions.',
      inputSchema: schema({
        date: dateField, session: choice(sessions), expected_revision: revisionField,
        items: array(itemSchema, 0, 30),
      }, ['date', 'session', 'expected_revision', 'items']),
      annotations: localWrite,
    },
    {
      name: 'get_fact_checks',
      description: 'Read latest saved verification for each matching claim, including conflicts and unverified results. A saved quote is a historical snapshot.',
      inputSchema: schema({
        date: dateField, market: choice(markets), session: choice(marketSessions), key: topicKey,
        limit: integer(1, 30),
      }, ['date']),
      annotations: readOnly,
    },
    {
      name: 'save_fact_check',
      description: 'Save a versioned public-source verification result. Do not use a URL as proof without reading it. For quotes include the observation timestamp with offset.',
      inputSchema: schema({
        date: dateField, market: choice(markets), session: choice(marketSessions), key: topicKey,
        expected_revision: revisionField, status: choice(checkStatuses), claim: text(1200),
        sources: array(sourceSchema, 0, 8), data_asof: timestamp, event_at: timestamp, note: text(1500),
        image_url: text(2000), image_source_url: text(2000), image_check: eventImageCheckSchema({ text, schema }),
      }, ['date', 'market', 'session', 'key', 'expected_revision', 'status', 'claim', 'sources']),
      annotations: localWrite,
    },
  ];

  function validateSource(source) {
    let url;
    try {
      url = new URL(source.url);
    } catch {
      throw new Error('Enter a full HTTP(S) source URL.');
    }
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error('Enter an HTTP(S) source URL without credentials.');
    }
    validateMarketTimestamp(source.retrieved_at, validateDate);
    validateMarketTimestamp(source.published_at, validateDate);
  }

  const handlers = {
    async get_handoff({ date, through_session = 'evening', lookback_days = 7 }) {
      validateDate(date);
      const firstDate = dateBefore(date, lookback_days);
      const throughIndex = sessions.indexOf(through_session);
      const ids = latestSnapshotIds(await listIds(), handoffPattern, ([, day, session]) =>
        day >= firstDate && (day < date || (day === date && sessions.indexOf(session) <= throughIndex)));
      const history = await Promise.all(ids.map((id) => readSnapshot(id, 'handoff')));
      history.sort((a, b) => a.date.localeCompare(b.date) || sessions.indexOf(a.session) - sessions.indexOf(b.session));
      const current = new Map();
      const sessionRevisions = {};
      for (const snapshot of history) {
        if (snapshot.date === date) sessionRevisions[snapshot.session] = snapshot.revision;
        for (const entry of snapshot.items) {
          current.set(entry.key, { ...entry, date: snapshot.date, session: snapshot.session });
        }
      }
      const items = [...current.values()];
      return {
        date, through_session, lookback_days, session_revisions: sessionRevisions,
        today: items.filter((item) => item.date === date),
        carryover: items.filter((item) => item.date < date && item.status === 'open'),
      };
    },

    async save_handoff({ date, session, expected_revision, items }) {
      validateDate(date);
      if (new Set(items.map((item) => item.key)).size !== items.length) throw new Error('Use unique item keys in each session.');
      for (const item of items) {
        const firstDate = item.key.slice(0, 10);
        validateDate(firstDate);
        if (firstDate > date) throw new Error('An item key cannot start on a future date.');
        if (item.category === 'published' && item.status !== 'completed') {
          throw new Error('Use published only for an actually published item.');
        }
        if (item.news_published_at && item.category !== 'published') {
          throw new Error('Use news_published_at only for a confirmed published news item.');
        }
        validateMarketTimestamp(item.news_published_at, validateDate);
      }
      return saveSnapshot(`handoff-${date}-${session}`, 'handoff', expected_revision, { date, session, items });
    },

    async get_fact_checks({ date, market, session, key, limit = 10 }) {
      validateDate(date);
      const ids = latestSnapshotIds(await listIds(), factPattern, ([, day, itemMarket, itemSession, itemKey]) =>
        day === date && (!market || itemMarket === market) && (!session || itemSession === session)
        && (!key || itemKey === key));
      const records = await Promise.all(ids.map((id) => readSnapshot(id, 'fact_check')));
      records.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id));
      return { date, records: records.slice(0, limit), total: records.length };
    },

    async save_fact_check({ expected_revision, ...fact }) {
      validateDate(fact.date);
      validateMarketTimestamp(fact.data_asof, validateDate);
      validateMarketTimestamp(fact.event_at, validateDate);
      for (const source of fact.sources) validateSource(source);
      if ((fact.image_url || fact.image_source_url) && !validEventImage(fact.image_url, fact.image_source_url)) {
        throw new Error('Provide the actual event image URL and its distinct article or announcement URL.');
      }
      if (fact.image_check) {
        const issue = eventImageIssue(fact.image_url, fact.image_source_url, fact.image_check, validateDate);
        if (issue) throw new Error(issue);
      }
      if (fact.status === 'verified' && (!fact.sources.length || (fact.session !== 'news' && !fact.data_asof))) {
        throw new Error('Verified claims need an actual source; verified market readings also need data_asof.');
      }
      const prefix = `fact-${fact.date}-${fact.market}-${fact.session}-${fact.key}`;
      return saveSnapshot(prefix, 'fact_check', expected_revision, fact);
    },
  };
  return { definitions, handlers };
}
