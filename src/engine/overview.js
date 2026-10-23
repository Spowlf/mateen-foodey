// Overview: Today, a week (Monday to Sunday) or a calendar month. A week's or month's main figure is
// the average kcal of its complete days against their targets; calories by meal and the top foods
// are totals of everything logged in it.

import { addDays, weekStart, datesFrom, parse, format, formatDay } from './dates.js';
import { isLive, entriesOn, dayTotal, isEstimated } from './entries.js';
import { dayState } from './days.js';
import { targetOn } from './summary.js';
import { MEALS } from './meals.js';
import { kcalOf, gramsOf, roundDiv, formatGrams, formatKcal } from './nutrition.js';

export const VIEWS = ['today', 'week', 'month'];
export const TOP_FOODS = 5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The first and last date of the period holding anchor. */
export function periodBounds(view, anchor) {
  if (view === 'week') return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) };
  if (view === 'month') {
    const [y, m] = parse(anchor);
    const from = format(y, m, 1);
    const next = m === 12 ? format(y + 1, 1, 1) : format(y, m + 1, 1);
    return { from, to: addDays(next, -1) };
  }
  return { from: anchor, to: anchor };
}

/** A date in the period n periods from the one holding anchor (n −1 is the one before). */
export function stepPeriod(view, anchor, n) {
  if (view === 'week') return addDays(weekStart(anchor), 7 * n);
  if (view === 'month') {
    const [y, m] = parse(anchor);
    const k = y * 12 + (m - 1) + n;
    return format(Math.floor(k / 12), (k % 12) + 1, 1);
  }
  return addDays(anchor, n);
}

/** "Today", "This Week", "Week of 12 Oct 2026", "October 2026". */
export function periodTitle(view, anchor, today) {
  const { from, to } = periodBounds(view, anchor);
  const current = from <= today && today <= to;
  if (view === 'today') return anchor === today ? 'Today' : formatDay(anchor);
  if (view === 'week') return current ? 'This Week' : `Week of ${formatDay(from)}`;
  const [y, m] = parse(from);
  return current ? 'This Month' : `${MONTHS[m - 1]} ${y}`;
}

/**
 * Protein days: days in the period until today on which protein reached the day's target. Today
 * counts only once it's reached, so a day still being eaten never counts against you.
 * { reached, of } or null when no day had a protein target.
 */
function proteinDays({ entries, dates, today, target }) {
  let reached = 0;
  let of = 0;
  let anyTarget = false;
  for (const d of dates) {
    const t = target(d);
    if (!t?.proteinG) continue;
    anyTarget = true;
    const ok = (dayTotal(entries, d).proteinUg ?? 0) >= t.proteinG * 1_000_000;
    if (ok) reached += 1;
    if (ok || d < today) of += 1;
  }
  return anyTarget ? { reached, of } : null;
}

/**
 * The period's figures. from and to bound it; days after today are left out.
 * { dates, completeDays, averageKcal, averageTargetKcal, average (Amounts a complete day, or null),
 *   protein: { reached, of } | null, byMeal: [{ meal, kcal, share }], topFoods: [{ name, kcal, times }],
 *   totalKcal, estimated, loggedDays }
 */
export function periodSummary({ entries, days, targets = [], settings = {}, activity = [], workouts = [], from, to, today }) {
  const dates = datesFrom(from, to < today ? to : today);
  const target = (date) => targetOn({ targets, settings, activity, workouts, date });
  const complete = dates.filter((d) => d !== today && dayState(days, d) === 'complete');

  let average = null;
  if (complete.length) {
    const sum = {};
    for (const f of ['kcalMilli', 'proteinUg', 'carbsUg', 'fatUg']) {
      const known = complete.map((d) => dayTotal(entries, d)[f]).filter((v) => v != null);
      sum[f] = known.length ? roundDiv(known.reduce((s, v) => s + v, 0), complete.length) : null;
    }
    average = sum;
  }
  const targetsKnown = complete.map(target).filter(Boolean);

  const live = dates.flatMap((d) => entriesOn(entries, d));
  const mealKcal = Object.fromEntries(MEALS.map((m) => [m, 0]));
  const foods = new Map();
  for (const e of live) {
    const milli = e.nutrition?.kcalMilli ?? 0;
    mealKcal[e.meal] = (mealKcal[e.meal] ?? 0) + milli;
    const key = e.foodId ? `food:${e.foodId}` : e.batchId ? `batch:${e.batchId}` : `name:${e.name}`;
    const f = foods.get(key) ?? { name: e.name, milli: 0, times: 0 };
    f.milli += milli;
    f.times += 1;
    foods.set(key, f);
  }
  const totalMilli = Object.values(mealKcal).reduce((s, v) => s + v, 0);

  return {
    dates,
    completeDays: complete.length,
    averageKcal: average ? kcalOf(average.kcalMilli) : null,
    averageTargetKcal: targetsKnown.length ? Math.round(targetsKnown.reduce((s, t) => s + t.kcal, 0) / targetsKnown.length) : null,
    average,
    protein: proteinDays({ entries, dates, today, target }),
    byMeal: MEALS.map((meal) => ({ meal, kcal: kcalOf(mealKcal[meal]), share: totalMilli ? mealKcal[meal] / totalMilli : 0 })),
    topFoods: [...foods.values()]
      .sort((a, b) => b.milli - a.milli || b.times - a.times || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, TOP_FOODS)
      .map((f) => ({ name: f.name, kcal: kcalOf(f.milli), times: f.times, share: totalMilli ? f.milli / totalMilli : 0 })),
    totalKcal: kcalOf(totalMilli),
    estimated: live.some(isEstimated),
    loggedDays: new Set(live.map((e) => e.date)).size,
  };
}

const MACROS = [['protein', 'proteinUg', 'proteinG', 4], ['carbs', 'carbsUg', 'carbsG', 4], ['fat', 'fatUg', 'fatG', 9]];

/**
 * Macros as meters: against the target where one is set ("92 g of 120 g", share of the target),
 * otherwise as a share of the kcal ("31 g, 28% of kcal"). amounts is a day's (or an average day's).
 * [{ name, grams, share, text }]; grams null when unknown.
 */
export function macroMeters(amounts, target) {
  const kcal = kcalOf(amounts?.kcalMilli) ?? 0;
  return MACROS.map(([name, field, targetField, kcalPerG]) => {
    const grams = gramsOf(amounts?.[field]);
    const goal = target?.[targetField] ?? null;
    if (grams == null) return { name, grams: null, share: 0, text: `${name[0].toUpperCase()}${name.slice(1)} unknown` };
    if (goal) return { name, grams, share: grams / goal, text: `${formatGrams(grams)} of ${formatGrams(goal)}` };
    const share = kcal ? (grams * kcalPerG) / kcal : 0;
    return { name, grams, share, text: `${formatGrams(grams)}, ${Math.round(share * 100)}% of kcal` };
  });
}

/** "Protein reached on 5 of 7 days." */
export function proteinDaysText(protein) {
  if (!protein) return null;
  return `Protein reached on ${protein.reached} of ${protein.of} ${protein.of === 1 ? 'day' : 'days'}.`;
}

/** "Average of 6 complete days, against 2,100 kcal." or what's missing. */
export function averageText(s) {
  if (!s.completeDays) {
    return s.loggedDays
      ? 'No complete days yet. Only days marked complete count in the average.'
      : 'Nothing logged yet.';
  }
  const days = `${s.completeDays} complete ${s.completeDays === 1 ? 'day' : 'days'}`;
  return s.averageTargetKcal == null ? `Average of ${days}.` : `Average of ${days}, against ${formatKcal(s.averageTargetKcal)}.`;
}

/** When Health last sent activity (the Health Shortcut's last run), in ms, or null. */
export function lastHealthSync(activity) {
  let at = null;
  for (const a of activity) if (isLive(a) && a.source === 'health' && (at == null || (a.updatedAt ?? 0) > at)) at = a.updatedAt ?? 0;
  return at;
}
