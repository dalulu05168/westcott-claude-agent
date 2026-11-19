import { isWeekday, validateMarketTimestamp } from './market-time.mjs';
import { publicWebUrl } from './news-image.mjs';

const bucharest = 'Europe/Bucharest';
const markets = { bvb: { timezone: bucharest, open: '10:00' },
  us: { timezone: 'America/New_York', open: '09:30' } };
const formatters = new Map(Object.values(markets).map(({ timezone }) => [timezone, new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
})]));

function localMinute(instant, timezone) {
  const parts = Object.fromEntries(formatters.get(timezone).formatToParts(instant).map(({ type, value }) => [type, value]));
  return parts.year.padStart(4, '0') + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
}

function openingInstant(date, time, timezone) {
  const target = date + 'T' + time;
  const naiveUtc = Date.parse(target + 'Z');
  const offset = Date.parse(localMinute(naiveUtc, timezone) + 'Z') - naiveUtc;
  const instant = naiveUtc - offset;
  if (localMinute(instant, timezone) !== target) throw new Error('Market local opening time could not be resolved.');
  return instant;
}

export function createMarketOperationsTool({ text, schema, dateField, validateDate }) {
  const definition = {
    name: 'plan_market_open',
    description: 'Apply the verified exchange calendar status to an opening scene and convert the opening time to Bucharest. Keeps opening coverage pending until a contemporaneous quote or user card has actually been confirmed.',
    inputSchema: schema({
      date: dateField, market: { ...text(8), enum: ['bvb', 'us'] },
      calendar_status: { ...text(12), enum: ['open', 'closed', 'unverified'] }, calendar_source: text(2000),
      exchange_open: { ...text(5), pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
      as_of: text(35), snapshot_as_of: text(35), snapshot_confirmed: { type: 'boolean' },
    }, ['date', 'market', 'calendar_status', 'as_of']),
    annotations: { readOnlyHint: true, openWorldHint: false },
  };

  function planMarketOpen({ date, market, calendar_status, calendar_source, exchange_open, as_of,
    snapshot_as_of, snapshot_confirmed = false }) {
    validateDate(date);
    validateMarketTimestamp(as_of, validateDate);
    validateMarketTimestamp(snapshot_as_of, validateDate);
    const base = { date, market, timezone: bucharest, calendar_source };
    if (calendar_status === 'unverified' || !publicWebUrl(calendar_source)) {
      return { ...base, status: 'calendar_unverified' };
    }
    if (calendar_status === 'closed') return { ...base, status: 'closed' };
    if (!isWeekday(date)) throw new Error('Verify the trading date. Regular equity sessions apply on weekdays.');
    const schedule = markets[market];
    const opening = openingInstant(date, exchange_open ?? schedule.open, schedule.timezone);
    const review = opening + 20 * 60 * 1000;
    const timing = { ...base, opens_bucharest: localMinute(opening, bucharest),
      suggested_check_bucharest: localMinute(review, bucharest) };
    const now = Date.parse(as_of);
    if (now < opening) return { ...timing, status: 'waiting_for_open' };
    if (!snapshot_confirmed || !snapshot_as_of) {
      return { ...timing, status: now < review ? 'waiting_for_delay' : 'waiting_for_snapshot' };
    }
    const snapshot = Date.parse(snapshot_as_of);
    if (snapshot < opening || snapshot > now || localMinute(snapshot, schedule.timezone).slice(0, 10) !== date) {
      throw new Error('The confirmed opening quote must be from this trading date, on or after open and by the scene cutoff.');
    }
    return { ...timing, status: 'ready', snapshot_as_of };
  }

  return { definitions: [definition], handlers: { plan_market_open: planMarketOpen } };
}
