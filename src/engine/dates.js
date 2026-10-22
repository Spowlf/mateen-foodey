// Calendar dates are 'YYYY-MM-DD' strings. The phone decides every date (see SPEC.md, Dates).
// All arithmetic is done in UTC so daylight saving never shifts a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

export function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function format(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

const toUtc = (date) => {
  const [y, m, d] = parse(date);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Today in the device's local time. Never use toISOString() for this. */
export function today(now = new Date()) {
  return format(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Local wall-clock time as 'HH:MM'. */
export function nowTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** The UTC date of an instant. Only the Worker's cost guard uses it: it's a spending cap, not user data. */
export function utcDate(ms) {
  return fromUtc(ms);
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return fromUtc(toUtc(date)) === date;
}

export function addDays(date, n) {
  return fromUtc(toUtc(date) + n * 86400000);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** Every date from a to b, inclusive. */
export function datesFrom(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date) {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

/** The Monday of the week that contains date. */
export function weekStart(date) {
  return addDays(date, -weekday(date));
}

/** "30 Sep 2026" */
export function formatDay(date) {
  const [y, m, d] = parse(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "30 Sep" */
export function formatDayShort(date) {
  const [, m, d] = parse(date);
  return `${d} ${MONTHS[m - 1]}`;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Tuesday" */
export const dayName = (date) => DAY_NAMES[weekday(date)];

/**
 * Local date and time from an ISO 8601 timestamp, keeping the offset it was written with,
 * so a Shortcut run in New York at 23:30 stays on its New York date. Returns null if it can't be read.
 * "2026-10-01T12:34:56+08:00" → { date: '2026-10-01', time: '12:34', at: <ms> }
 */
export function partsFromIso(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', zone] = m;
  if (!validDate(`${y}-${mo}-${d}`) || +h > 23 || +mi > 59) return null;
  let offsetMin = 0;
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  }
  const at = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMin * 60000;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, at };
}
