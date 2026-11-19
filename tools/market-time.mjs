const offsetTimestamp = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

export function isWeekday(date) {
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return day >= 1 && day <= 5;
}

export function validateMarketTimestamp(value, validateDate) {
  if (value === undefined) return;
  const match = offsetTimestamp.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    throw new Error('Use an RFC 3339 timestamp with seconds and a timezone offset.');
  }
  validateDate(match[1]);
}
