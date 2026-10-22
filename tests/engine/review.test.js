import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewWeek, reviewWeekFromTimestamp, weekSummary, weeklyText } from '../../src/engine/summary.js';
import { reviewDays, markDaysLabel, dayRows, dayState } from '../../src/engine/days.js';
import { eaten, weighIn, day, range } from './fixtures.js';

const targets = [{ id: '2026-10-01', fromDate: '2026-10-01', mode: 'fixed', kcal: 2000, proteinG: 120, goalRateG: -500, deletedAt: null }];

test('review bounds: the previous Monday to Sunday', () => {
  assert.equal(reviewWeek('2026-10-19'), '2026-10-12');   // Monday: the week just ended
  assert.equal(reviewWeek('2026-10-25'), '2026-10-12');   // any day of that week looks back at the same one
  assert.equal(reviewWeek('2026-10-18'), '2026-10-05');   // Sunday is still in its own week
});

test('review bounds: from a Monday timestamp in any offset', () => {
  assert.equal(reviewWeekFromTimestamp('2026-10-19T07:00:00+01:00'), '2026-10-12');
  assert.equal(reviewWeekFromTimestamp('2026-10-19T07:00:00-07:00'), '2026-10-12');
  // Monday 00:30 in Singapore is still Sunday in UTC: the phone's offset decides.
  assert.equal(reviewWeekFromTimestamp('2026-10-19T00:30:00+08:00'), '2026-10-12');
  // Sunday 23:30 in New York is Monday in UTC: still Sunday where the phone is.
  assert.equal(reviewWeekFromTimestamp('2026-10-18T23:30:00-05:00'), '2026-10-05');
  assert.equal(reviewWeekFromTimestamp('yesterday'), null);
});

function week() {
  const dates = range('2026-10-12', '2026-10-18');
  const entries = [
    ...dates.slice(0, 6).map((d, i) => eaten(d, 1800, { proteinG: i < 5 ? 125 : 90 })),
    eaten('2026-10-18', 900, { proteinG: 40 }),
    eaten('2026-10-19', 5000, { proteinG: 200 }),                        // next week: not counted
    eaten('2026-10-11', 5000, { proteinG: 200 }),                        // week before: not counted
    eaten('2026-10-17', 300, { status: 'toCheck', proteinG: 5 }),
  ];
  const days = [...dates.slice(0, 6).map((d) => day(d, 'complete')), day('2026-10-19', 'complete'), day('2026-10-11', 'complete')];
  const weights = [weighIn('2026-10-11', 80_000), weighIn('2026-10-14', 79_000), weighIn('2026-10-18', 79_000)];
  return { entries, days, weights };
}

test('weekly summary: complete-day average, protein days and unreviewed count for the week', () => {
  const w = week();
  const s = weekSummary({ ...w, targets, start: '2026-10-12' });
  assert.equal(s.end, '2026-10-18');
  assert.equal(s.completeDays, 6);
  assert.equal(s.averageKcal, Math.round((1800 * 6 + 300) / 6));   // 17 Oct's To check entry counts as eaten
  assert.equal(s.averageTargetKcal, 2000);
  assert.equal(s.proteinDays, 5);
  assert.equal(s.unreviewed, 1);
  assert.equal(s.toCheck, 1);
  assert.ok(s.trendChangeGrams < 0);
});

test('weekly summary: the notification text', () => {
  const s = weekSummary({ ...week(), targets, start: '2026-10-12' });
  assert.equal(weeklyText(s), 'Week of 12 Oct 2026. Average 1,850 kcal on 6 complete days, against 2,000 kcal. Protein reached on 5 of 7 days. Trend fell 0.2 kg. 1 entry to check. 1 day to review.');
  const empty = weekSummary({ entries: [], days: [], start: '2026-10-12' });
  assert.equal(weeklyText(empty), 'Week of 12 Oct 2026. No complete days yet. 7 days to review.');
});

test('"Mark N Days Complete": only unflagged unreviewed days in the reviewed week, never today', () => {
  const dates = range('2026-10-12', '2026-10-18');
  const entries = [
    eaten('2026-10-14', 1000),                      // 50% of 2,000: flagged
    eaten('2026-10-15', 1200),                      // exactly 60%: not flagged
    ...['2026-10-16', '2026-10-17', '2026-10-18'].map((d) => eaten(d, 1900)),
  ];
  const days = [day('2026-10-12', 'complete'), day('2026-10-13', 'incomplete')];
  const targetKcal = () => 2000;
  const r = reviewDays({ weekStart: '2026-10-12', today: '2026-10-19', days, entries, targetKcal });
  assert.deepEqual(r.toMark, ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.deepEqual(r.flagged, ['2026-10-14']);
  assert.equal(markDaysLabel(r.toMark.length), 'Mark 4 Days Complete');
  assert.equal(markDaysLabel(1), 'Mark 1 Day Complete');
  // Today and later are never marked, even inside the week.
  const midweek = reviewDays({ weekStart: '2026-10-12', today: '2026-10-16', days, entries, targetKcal });
  assert.deepEqual(midweek.toMark, ['2026-10-15']);
  // Marking writes rows only for those days.
  const marked = [...days, ...dayRows(r.toMark, 'complete')];
  assert.deepEqual(dates.map((d) => dayState(marked, d)), ['complete', 'incomplete', 'unreviewed', 'complete', 'complete', 'complete', 'complete']);
});
