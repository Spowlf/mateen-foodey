// The maintenance estimate: what you'd eat to hold your weight, from what you logged and how your
// trend weight moved. Only complete days count.
//
//   estimate = average intake on complete days in the 28 days to end
//              − 7,700 × trend change over the window (kg) ÷ 28
//
// It needs 14 complete days and 8 weigh-ins in the window. It moves at most 150 kcal a week: the
// estimate is worked out for each week (to each Sunday before end, then end) and each one is held
// within 150 kcal of the week before, so nothing extra has to be stored.

import { addDays } from './dates.js';
import { dayTotal } from './entries.js';
import { completeDates } from './days.js';
import { trendSeries, weighInsBetween } from './weight.js';
import { formatKcal } from './nutrition.js';

export const WINDOW_DAYS = 28;
export const MIN_COMPLETE_DAYS = 14;
export const MIN_WEIGH_INS = 8;
export const WEEKLY_CAP_KCAL = 150;
export const KCAL_PER_KG = 7700;

/** The estimate for the 28 days to end, uncapped: { ok, kcal?, completeDays, weighIns }. */
export function rawEstimate({ entries, days, weights, end }) {
  const start = addDays(end, -(WINDOW_DAYS - 1));
  const complete = [...completeDates(days)].filter((d) => d >= start && d <= end);
  const weighIns = weighInsBetween(weights, start, end);
  const base = { completeDays: complete.length, weighIns };
  if (complete.length < MIN_COMPLETE_DAYS || weighIns < MIN_WEIGH_INS) return { ok: false, ...base };
  const intakeMilli = complete.reduce((s, d) => s + (dayTotal(entries, d).kcalMilli ?? 0), 0);
  // The trend's change across the window: from the day before it (or the first reading in it) to its last day.
  const series = trendSeries(weights, end).filter((p) => p.date >= addDays(start, -1) && p.trendGrams != null);
  const changeGrams = series.length ? series.at(-1).trendGrams - series[0].trendGrams : 0;
  const kcal = intakeMilli / complete.length / 1000 - (KCAL_PER_KG * changeGrams) / 1000 / WINDOW_DAYS;
  return { ok: true, ...base, kcal: Math.round(kcal), changeGrams };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What's still needed, each part only while it's needed: "Log 6 more complete days and add 2 more weigh-ins." */
export function neededMessage({ completeDays, weighIns }) {
  const days = Math.max(0, MIN_COMPLETE_DAYS - completeDays);
  const ins = Math.max(0, MIN_WEIGH_INS - weighIns);
  const parts = [];
  if (days) parts.push(`log ${plural(days, 'more complete day', 'more complete days')}`);
  if (ins) parts.push(`add ${plural(ins, 'more weigh-in', 'more weigh-ins')}`);
  if (!parts.length) return null;
  const s = parts.join(' and ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

/**
 * The estimate as of end, each week held within 150 kcal of the one before.
 * { ok: true, kcal, completeDays, weighIns, capped, text } or { ok: false, completeDays, weighIns, text }.
 */
export function maintenanceEstimate({ entries, days, weights, end }) {
  const latest = rawEstimate({ entries, days, weights, end });
  if (!latest.ok) return { ...latest, text: neededMessage(latest) };
  // Walk back week by week while the estimate holds, then forward, capping each week's move.
  const chain = [latest];
  for (let e = addDays(end, -7); ; e = addDays(e, -7)) {
    const r = rawEstimate({ entries, days, weights, end: e });
    if (!r.ok) break;
    chain.unshift(r);
  }
  let kcal = chain[0].kcal;
  let capped = false;
  for (const r of chain.slice(1)) {
    const next = Math.min(kcal + WEEKLY_CAP_KCAL, Math.max(kcal - WEEKLY_CAP_KCAL, r.kcal));
    capped = next !== r.kcal;
    kcal = next;
  }
  return {
    ok: true,
    kcal,
    completeDays: latest.completeDays,
    weighIns: latest.weighIns,
    capped,
    text: `~${formatKcal(kcal)}, from ${plural(latest.completeDays, 'complete day', 'complete days')} and your weight trend.`,
  };
}
