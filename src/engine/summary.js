// The weekly review and its summary cover the previous Monday to Sunday: run on a Monday, they look
// back at the week just ended. The date comes from the phone (a timestamp's own offset picks it).

import { addDays, weekStart, datesFrom, partsFromIso, formatDay } from './dates.js';
import { dayTotal, isLive } from './entries.js';
import { dayState } from './days.js';
import { dayTarget } from './targets.js';
import { dayExercise } from './exercise.js';
import { trendSeries, formatWeightChange } from './weight.js';
import { roundDiv, formatKcal } from './nutrition.js';

/** The Monday that starts the reviewed week: the week before the one date falls in. */
export const reviewWeek = (date) => addDays(weekStart(date), -7);

/** The same, from a timestamp with its offset ("2026-10-26T07:00:00-04:00"). null if it can't be read. */
export function reviewWeekFromTimestamp(timestamp) {
  const parts = partsFromIso(timestamp);
  return parts ? reviewWeek(parts.date) : null;
}

/** Day target for date with that day's exercise. */
export function targetOn({ targets, settings, activity, workouts, date }) {
  return dayTarget({ targets, date, settings, exerciseKcal: dayExercise({ activity, workouts, date }).kcal });
}

/**
 * The reviewed week's figures. start is its Monday.
 * { start, end, completeDays, averageKcal, averageTargetKcal, proteinDays, proteinTargetSet,
 *   trendChangeGrams, toCheck, unreviewed }
 */
export function weekSummary({ entries, days, weights = [], targets = [], settings = {}, activity = [], workouts = [], start }) {
  const end = addDays(start, 6);
  const dates = datesFrom(start, end);
  const complete = dates.filter((d) => dayState(days, d) === 'complete');
  const target = (date) => targetOn({ targets, settings, activity, workouts, date });

  const kcalMilli = complete.reduce((s, d) => s + (dayTotal(entries, d).kcalMilli ?? 0), 0);
  const targetsKnown = complete.map(target).filter(Boolean);
  const proteinDays = dates.filter((d) => {
    const t = target(d);
    return t?.proteinG && (dayTotal(entries, d).proteinUg ?? 0) >= t.proteinG * 1_000_000;
  }).length;

  // The trend's change from the end of the week before to the end of this one.
  const series = trendSeries(weights, end).filter((p) => p.date >= addDays(start, -1) && p.trendGrams != null);
  const trendChangeGrams = series.length > 1 ? series.at(-1).trendGrams - series[0].trendGrams : null;

  return {
    start,
    end,
    completeDays: complete.length,
    averageKcal: complete.length ? roundDiv(kcalMilli, complete.length * 1000) : null,
    averageTargetKcal: targetsKnown.length ? Math.round(targetsKnown.reduce((s, t) => s + t.kcal, 0) / targetsKnown.length) : null,
    proteinDays,
    proteinTargetSet: dates.some((d) => target(d)?.proteinG),
    trendChangeGrams,
    toCheck: entries.filter((e) => isLive(e) && e.status === 'toCheck').length,
    unreviewed: dates.filter((d) => dayState(days, d) === 'unreviewed').length,
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The summary as one notification's text. */
export function weeklyText(s, { weightUnit = 'kg' } = {}) {
  const lines = [`Week of ${formatDay(s.start)}.`];
  if (s.completeDays) {
    const against = s.averageTargetKcal == null ? '' : `, against ${formatKcal(s.averageTargetKcal)}`;
    lines.push(`Average ${formatKcal(s.averageKcal)} on ${plural(s.completeDays, 'complete day', 'complete days')}${against}.`);
  } else {
    lines.push('No complete days yet.');
  }
  if (s.proteinTargetSet) lines.push(`Protein reached on ${s.proteinDays} of 7 days.`);
  if (s.trendChangeGrams != null) {
    const size = formatWeightChange(s.trendChangeGrams, weightUnit);
    const rounded = Number(size.split(' ')[0]);
    lines.push(rounded === 0 ? 'Trend held steady.' : `Trend ${s.trendChangeGrams < 0 ? 'fell' : 'rose'} ${size}.`);
  }
  if (s.toCheck) lines.push(`${plural(s.toCheck, 'entry', 'entries')} to check.`);
  if (s.unreviewed) lines.push(`${plural(s.unreviewed, 'day', 'days')} to review.`);
  return lines.join(' ');
}
