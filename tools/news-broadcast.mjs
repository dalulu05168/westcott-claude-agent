import { getBlocks } from './speech-format.mjs';
import { isWeekday, validateMarketTimestamp } from './market-time.mjs';
import { eventImageCheckSchema, eventImageIssue, publicWebUrl } from './news-image.mjs';
import { allowedMemberField, allowedStaffField, sceneRoleIssues, sceneScopeField, sessionLimits } from './scene-rules.mjs';

const entryTypes = ['news', 'us_overnight_major', 'us_previous_session_indicators'];
const areas = ['romania', 'us', 'other'];
const areaCountry = { romania: '罗马尼亚', us: '美国' };
const overnightStartHour = 18;
const choice = (values) => ({ type: 'string', enum: values, maxLength: 40 });
const bucharestDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
const newYorkDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

function dayAt(value, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(value).map(({ type, value: part }) => [type, part]));
  return [parts.year.padStart(4, '0'), parts.month, parts.day].join('-');
}

function previousDay(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function previousUsSession(date, closures) {
  let candidate = previousDay(date);
  while (!isWeekday(candidate) || closures.has(candidate)) candidate = previousDay(candidate);
  return candidate;
}

export function createNewsBroadcastTools({ text, schema, dateField, validateDate, getHandoff }) {
  const timestamp = text(35);
  const sessionField = choice(Object.keys(sessionLimits));
  const entrySchema = schema({
    kind: choice(entryTypes), area: choice(areas), country: text(24), title: text(300),
    published_at: timestamp, data_asof: timestamp, image_url: text(2000), image_source_url: text(2000),
    image_check: eventImageCheckSchema({ text, schema }),
  }, ['kind', 'area', 'title']);
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const definitions = [
    {
      name: 'validate_news_broadcast',
      description: 'Check unsent news in proposed broadcast order against the Bucharest local date and confirmed broadcasts. Prior-day exceptions are limited to the morning US recap.',
      inputSchema: schema({
        date: dateField, session: sessionField,
        entries: { type: 'array', items: entrySchema, minItems: 0, maxItems: 40 },
        as_of: timestamp, previous_news_published_at: timestamp, previous_us_session_date: dateField,
        previous_us_session_source: text(2000),
        closed_us_session_dates: { type: 'array', items: dateField, minItems: 0, maxItems: 31 },
      }, ['date', 'session', 'entries']),
      annotations: readOnly,
    },
    {
      name: 'validate_scene_count',
      description: 'Check labelled messages and scene roles. Full mornings use 32–35; full evenings allow up to 35; afternoon full scenes and excerpts use 30–34. Use partial for localized text. David (teacher) has 0 messages in morning and afternoon, even with allowed_staff. Use allowed_member_ids for explicitly named archived members in a local edit.',
      inputSchema: schema({ session: sessionField, body: text(160000),
        scope: sceneScopeField, allowed_staff: allowedStaffField, allowed_member_ids: allowedMemberField }, ['session', 'body']),
      annotations: readOnly,
    },
  ];

  const handlers = {
    async validate_news_broadcast({ date, session, entries, as_of, previous_news_published_at,
      previous_us_session_date, previous_us_session_source, closed_us_session_dates = [] }) {
      validateDate(date);
      if (previous_us_session_date) validateDate(previous_us_session_date);
      for (const closed of closed_us_session_dates) validateDate(closed);
      validateMarketTimestamp(as_of, validateDate);
      validateMarketTimestamp(previous_news_published_at, validateDate);
      const cutoff = as_of ? Date.parse(as_of) : Infinity;
      const preceding = await getHandoff({ date, through_session: session, lookback_days: 0 });
      const previousTimes = preceding.today.filter((item) => item.category === 'published' && item.news_published_at)
        .map((item) => item.news_published_at);
      if (previous_news_published_at) previousTimes.push(previous_news_published_at);
      let latestPublished = previousTimes.reduce((latest, time) =>
        latest === null || Date.parse(time) > Date.parse(latest) ? time : latest, null);
      const previousBroadcastTime = latestPublished;
      const previousLocalDay = previousDay(date);
      const lastUsSession = previousUsSession(date, new Set(closed_us_session_dates));
      const issues = [];
      const expectedNews = [];

      for (const [index, entry] of entries.entries()) {
        const issue = (message) => issues.push({ entry: index + 1, title: entry.title, message });
        const morningException = session === 'morning' && entry.area === 'us' && entry.kind !== 'news';
        if (entry.kind !== 'news' && !morningException) {
          issue('前夜或上一交易日例外仅用于上午的美股回顾。');
        }
        try {
          validateMarketTimestamp(entry.published_at, validateDate);
          validateMarketTimestamp(entry.data_asof, validateDate);
        } catch (error) {
          issue(error.message);
          continue;
        }
        if (entry.kind === 'us_previous_session_indicators') {
          if (!entry.data_asof) {
            issue('上一交易日指标需要数据截点和时区。');
          } else if (!previous_us_session_date || !publicWebUrl(previous_us_session_source)) {
            issue('请查美股交易所日历并提供实际上一交易日的纽约日期及来源。');
          } else if (previous_us_session_date !== lastUsSession) {
            issue('所给交易日与日历不连贯。若中间有工作日休市，请提供已核实的休市日期。');
          } else {
            const instant = Date.parse(entry.data_asof);
            if (dayAt(instant, newYorkDate) !== previous_us_session_date || instant > cutoff) {
              issue('指标截点必须来自已发生的美股上一交易日。');
            }
          }
          continue;
        }
        const country = entry.country ?? areaCountry[entry.area];
        if (!country || (areaCountry[entry.area] && country !== areaCountry[entry.area])) {
          issue('请填写与事件所属地区一致的播报国家。');
        }
        const imageIssue = eventImageIssue(entry.image_url, entry.image_source_url, entry.image_check, validateDate);
        if (imageIssue) issue(imageIssue);
        if (!entry.published_at) {
          issue('需要查到新闻原始发布时间及其时区。');
          continue;
        }
        const instant = Date.parse(entry.published_at);
        const publicationDay = dayAt(instant, bucharestDate);
        const localHour = Number(bucharestDate.formatToParts(instant).find((part) => part.type === 'hour').value);
        const isPriorNight = publicationDay === previousLocalDay && localHour >= overnightStartHour;
        if (entry.kind === 'us_overnight_major' && !isPriorNight) {
          issue('前夜例外只收录布加勒斯特上一日 18:00 起至午夜前首发的美国重大新闻。同日事件按当日新闻处理。');
        } else if (publicationDay !== date && !(morningException && isPriorNight)) {
          issue(`按罗马尼亚时间该新闻发布于 ${publicationDay}，与播报日期不符。`);
        }
        if (instant > cutoff) issue('原始发布时间晚于当前播报截点。');
        if (latestPublished && instant < Date.parse(latestPublished)) {
          issue(`该新闻比已排在前面的发布时间 ${latestPublished} 更早，请调整顺序或移出本场。`);
        }
        if (latestPublished === null || instant > Date.parse(latestPublished)) latestPublished = entry.published_at;
        expectedNews.push({ country, title: entry.title, image_url: entry.image_url });
      }

      return { passed: issues.length === 0, date, session, checked_entries: entries.length,
        previous_broadcast_published_at: previousBroadcastTime, issues,
        expected_news: issues.length ? [] : expectedNews };
    },

    async validate_scene_count({ session, body, scope = 'full', allowed_staff, allowed_member_ids }) {
      const [minimum, maximum] = sessionLimits[session];
      const blocks = getBlocks(body);
      const empty = blocks.filter((block) => !block.lines.some((line) => line.trim()));
      const count = blocks.length - empty.length;
      const issues = [
        ...empty.map((block) => ({ line: block.line, message: '角色标记下没有正文。' })),
        ...sceneRoleIssues(blocks, { session, allowed_staff, allowed_member_ids, scope }),
      ];
      if (!blocks.length) issues.push({ line: 1, message: '找不到带标记的发言。' });
      const applied = scope === 'full' || (session === 'afternoon' && scope === 'excerpt');
      if (applied && (count < minimum || count > maximum)) {
        const label = scope === 'excerpt' ? '下午场节选' : '完整场次';
        const expected = minimum ? `应为 ${minimum}–${maximum} 条` : `最多 ${maximum} 条`;
        issues.push({ message: `${label}${expected}，当前为 ${count} 条。` });
      }
      return { passed: issues.length === 0, session, scope, applied, count, minimum, maximum, issues };
    },
  };
  return { definitions, handlers };
}
