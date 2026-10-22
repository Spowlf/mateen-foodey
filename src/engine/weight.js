// Body weight: readings in integer grams, the trend, and kg / st lb.
// The trend is worked out from the readings each time and never stored, so it's kept as a fraction
// of a gram and rounded only for display.

import { addDays } from './dates.js';
import { isLive } from './entries.js';

export const TREND_ALPHA = 0.1;
const GRAMS_PER_LB = 453.59237;

/** Readings by date (one a day; the latest saved wins). */
function readings(weights) {
  const byDate = new Map();
  for (const w of weights) {
    if (!isLive(w)) continue;
    const had = byDate.get(w.date);
    if (!had || (w.updatedAt ?? 0) >= (had.updatedAt ?? 0)) byDate.set(w.date, w);
  }
  return byDate;
}

/**
 * The trend from the first reading to until, day by day: an exponential moving average with α = 0.1
 * a day, carried forward unchanged across days with no reading. [{ date, trendGrams, readingGrams }]
 */
export function trendSeries(weights, until) {
  const byDate = readings(weights);
  if (!byDate.size) return [];
  const first = [...byDate.keys()].sort()[0];
  const out = [];
  let trend = null;
  for (let d = first; d <= until; d = addDays(d, 1)) {
    const r = byDate.get(d)?.grams ?? null;
    if (r != null) trend = trend == null ? r : trend + TREND_ALPHA * (r - trend);
    out.push({ date: d, trendGrams: trend, readingGrams: r });
  }
  return out;
}

/** The trend on a date, or null before the first reading. */
export function trendOn(weights, date) {
  const series = trendSeries(weights, date);
  return series.length ? series.at(-1).trendGrams : null;
}

/** Readings from a to b, inclusive. */
export function weighInsBetween(weights, a, b) {
  return [...readings(weights).keys()].filter((d) => d >= a && d <= b).length;
}

/** "72.4 kg" or "11 st 6 lb". */
export function formatWeight(grams, unit = 'kg') {
  if (unit === 'stlb') {
    const lb = Math.round(grams / GRAMS_PER_LB);
    const st = Math.floor(lb / 14);
    return st ? `${st} st ${lb % 14} lb` : `${lb} lb`;
  }
  return `${(Math.round(grams / 100) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
}

/** A change's size, unsigned: "0.3 kg" or "0.7 lb". The words around it say which way. */
export function formatWeightChange(grams, unit = 'kg') {
  const abs = Math.abs(grams);
  const n = unit === 'stlb' ? abs / GRAMS_PER_LB : abs / 1000;
  return `${(Math.round(n * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit === 'stlb' ? 'lb' : 'kg'}`;
}
