// The weekly review, on Log from Monday until it's done. It looks back at the previous Monday to
// Sunday: clear To check, mark the week's days, see the week, then the target. In adaptive mode the
// new estimate gives the target; in fixed mode the trend against the goal suggests one. A target
// changes only when you accept it here.

import { addDays } from './dates.js';
import { isLive } from './entries.js';
import { reviewWeek } from './summary.js';
import { adaptiveKcal, dailyChangeKcal, DEFAULT_FLOOR_KCAL } from './targets.js';
import { formatWeightChange } from './weight.js';
import { formatKcal } from './nutrition.js';

/** A fixed target moves at most this much a week, as the maintenance estimate does. */
export const SUGGESTION_CAP_KCAL = 150;
/** A gap smaller than this isn't worth changing the target for. */
export const ON_TRACK_KCAL = 50;

/**
 * The Monday starting the week to review, or null when there's none: it's done, or nothing was
 * logged or weighed that week (nothing to look back at).
 */
export function reviewDue({ reviews, entries, weights = [], today }) {
  const start = reviewWeek(today);
  const end = addDays(start, 6);
  if (reviews.some((r) => isLive(r) && r.id === start)) return null;
  const inWeek = (r) => isLive(r) && r.date >= start && r.date <= end;
  return entries.some(inWeek) || weights.some(inWeek) ? start : null;
}

/** Weeks reviewed in a row up to weekStart (the one just done counts). */
export function weeksInARow(reviews, weekStart) {
  const done = new Set(reviews.filter(isLive).map((r) => r.id));
  done.add(weekStart);
  let n = 0;
  for (let w = weekStart; done.has(w); w = addDays(w, -7)) n += 1;
  return n;
}

/** "Reviewed 3 weeks in a row." or "Week reviewed." */
export const doneText = (n) => (n > 1 ? `Reviewed ${n} weeks in a row.` : 'Week reviewed.');

const goalWords = (goalRateG, unit) => {
  if (!goalRateG) return 'a goal of holding steady';
  return `a goal of ${goalRateG < 0 ? 'losing' : 'gaining'} ${formatWeightChange(goalRateG, unit)}`;
};

/** "Your trend fell 0.1 kg against a goal of losing 0.5 kg." */
export function trendAgainstGoal(trendChangeGrams, goalRateG, unit = 'kg') {
  if (trendChangeGrams == null) return 'Not enough weigh-ins this week to see your trend.';
  const size = formatWeightChange(trendChangeGrams, unit);
  const moved = Number(size.split(' ')[0]) === 0 ? 'held steady' : `${trendChangeGrams < 0 ? 'fell' : 'rose'} ${size}`;
  return `Your trend ${moved} against ${goalWords(goalRateG, unit)}.`;
}

const round10 = (n) => Math.round(n / 10) * 10;

/**
 * The target step. current is the targets row in force (null: none set yet). Adaptive: the
 * estimate to the reviewed week's end ± the goal rate. Fixed: the gap between the trend's change
 * and the goal, in kcal a day (7,700 kcal a kg), at most 150 kcal, to the nearest 10.
 * { mode, currentKcal, proposedKcal (null when there's nothing to change), text }
 */
export function reviewTarget({ current, estimate, trendChangeGrams, floorKcal = DEFAULT_FLOOR_KCAL, unit = 'kg' }) {
  if (!current) return { mode: null, currentKcal: null, proposedKcal: null, text: 'No daily target yet. Set one in Settings.' };
  const currentKcal = current.kcal;
  const goal = current.goalRateG ?? 0;
  if (current.mode === 'adaptive') {
    if (!estimate?.ok) return { mode: 'adaptive', currentKcal, proposedKcal: null, text: `${estimate?.text ?? ''} Until then, your target stays as it is.`.trim() };
    const proposed = adaptiveKcal({ maintenanceKcal: estimate.kcal, goalRateG: goal, floorKcal });
    const change = dailyChangeKcal(goal);
    const how = `Your maintenance estimate is ${estimate.text}`;
    const target = `With your goal, that’s ${formatKcal(proposed)} a day${change ? ` (${change < 0 ? 'less' : 'plus'} ${formatKcal(Math.abs(change))})` : ''}${proposed === floorKcal && estimate.kcal + change < floorKcal ? ', held at your floor' : ''}.`;
    return { mode: 'adaptive', currentKcal, proposedKcal: proposed === currentKcal ? null : proposed, text: `${how} ${target}` };
  }
  const trendLine = trendAgainstGoal(trendChangeGrams, goal, unit);
  if (trendChangeGrams == null) return { mode: 'fixed', currentKcal, proposedKcal: null, text: trendLine };
  // Behind the goal (lost too little, or gained too much) means eating less; ahead means more.
  const gapKcal = ((trendChangeGrams - goal) * 11) / 10;
  if (Math.abs(gapKcal) < ON_TRACK_KCAL) return { mode: 'fixed', currentKcal, proposedKcal: null, text: `${trendLine} You’re on track.` };
  const step = Math.max(-SUGGESTION_CAP_KCAL, Math.min(SUGGESTION_CAP_KCAL, -gapKcal));
  const proposed = Math.max(floorKcal, round10(currentKcal + step));
  return {
    mode: 'fixed', currentKcal, proposedKcal: proposed === currentKcal ? null : proposed,
    text: `${trendLine} One week is noisy, so the suggestion moves at most ${formatKcal(SUGGESTION_CAP_KCAL)}.`,
  };
}
