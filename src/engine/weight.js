// Body weight: readings in integer grams, the trend, and kg / st lb.
// The trend is worked out from the readings each time and never stored, so it's kept as a fraction
// of a gram and rounded only for display.

import { addDays, formatDay, partsFromIso } from './dates.js';
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

const MIN_WEIGHT_G = 20_000;
const MAX_WEIGHT_G = 400_000;

/** A decimal typed with a point or a comma, at most one place: "72.4" → 72.4. null when it isn't one. */
const typedDecimal = (text) => {
  const t = String(text ?? '').trim().replace(',', '.');
  return /^\d+(\.\d)?$/.test(t) ? Number(t) : null;
};

/**
 * A weight typed in kg ("72.4") or in stones and pounds ({ st: '11', lb: '6.5' }), converted once to
 * whole grams. Returns { grams } or { error } (what to do, as a sentence).
 */
export function weightFromText({ unit = 'kg', kg, st, lb }) {
  let grams;
  if (unit === 'stlb') {
    const s = String(st ?? '').trim() === '' ? 0 : typedDecimal(st);
    const p = String(lb ?? '').trim() === '' ? 0 : typedDecimal(lb);
    if (s == null || p == null || !Number.isInteger(s) || p >= 14 || (!s && !p)) return { error: 'Enter stones and pounds, with pounds under 14.' };
    grams = Math.round((s * 14 + p) * GRAMS_PER_LB);
  } else {
    const k = typedDecimal(kg);
    if (k == null) return { error: 'Enter your weight in kg, like 72.4.' };
    grams = Math.round(k * 1000);
  }
  if (grams < MIN_WEIGHT_G || grams > MAX_WEIGHT_G) return { error: 'Enter a weight from 20 to 400 kg.' };
  return { grams };
}

/** A weight as text for editing: { kg: '72.4' } or { st: '11', lb: '6.5' }. */
export function weightText(grams, unit = 'kg') {
  if (unit === 'stlb') {
    const lb = Math.round((grams / GRAMS_PER_LB) * 10) / 10;
    return { st: String(Math.floor(lb / 14)), lb: String(Math.round((lb % 14) * 10) / 10) };
  }
  return { kg: String(Math.round(grams / 100) / 10) };
}

/** The first date a chart range shows: '1m' the last 30 days, '3m' the last 91, 'all' everything. */
export function rangeStart(range, today, weights) {
  if (range === '1m') return addDays(today, -30);
  if (range === '3m') return addDays(today, -91);
  const dates = [...readings(weights).keys()].sort();
  return dates[0] ?? today;
}

/** The trend and readings from a to b: [{ date, trendGrams, readingGrams }], days before the first reading left out. */
export const weightPoints = (weights, a, b) => trendSeries(weights, b).filter((p) => p.date >= a);

/** The latest reading on or before date: { date, grams } or null. */
export function lastReading(weights, date) {
  const dates = [...readings(weights).keys()].filter((d) => d <= date).sort();
  if (!dates.length) return null;
  const d = dates.at(-1);
  return { date: d, grams: readings(weights).get(d).grams };
}

/**
 * A chart's weight axis in clean steps of the unit: kg in 0.5, 1, 2 or 5 kg; st lb in 1, 2, 5, 7 or
 * 14 lb. { min, max, ticks } in grams, about four steps, with the readings inside.
 */
export function weightScale(minGrams, maxGrams, unit = 'kg', steps = 4) {
  const per = unit === 'stlb' ? GRAMS_PER_LB : 1000;
  const choices = unit === 'stlb' ? [1, 2, 5, 7, 14, 28] : [0.5, 1, 2, 5, 10, 20];
  let lo = minGrams / per;
  let hi = maxGrams / per;
  if (hi - lo < choices[0]) { lo -= choices[0] / 2; hi += choices[0] / 2; }
  const step = choices.find((c) => c >= (hi - lo) / steps) ?? choices.at(-1);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t * per));
  return { min: Math.round(min * per), max: Math.round(max * per), ticks, step };
}

/** An axis label: "72.5" kg or "11 st 6" for st lb (the legend names the unit). */
export function weightTick(grams, unit = 'kg') {
  if (unit === 'stlb') {
    const lb = Math.round(grams / GRAMS_PER_LB);
    return `${Math.floor(lb / 14)} st ${lb % 14}`;
  }
  return (Math.round(grams / 100) / 10).toLocaleString('en-GB');
}

/**
 * How the trend moved across the points: "Down 0.6 kg since 23 Sep 2026.", "Up 0.2 kg …" or
 * "Steady since …". null with fewer than two days of trend.
 */
export function trendChangeText(points, unit = 'kg') {
  const known = points.filter((p) => p.trendGrams != null);
  if (known.length < 2) return null;
  const change = known.at(-1).trendGrams - known[0].trendGrams;
  const size = formatWeightChange(change, unit);
  const since = `since ${formatDay(known[0].date)}`;
  return Number(size.split(' ')[0]) === 0 ? `Steady ${since}.` : `${change < 0 ? 'Down' : 'Up'} ${size} ${since}.`;
}

const LB_PER_ST = 14;
const attr = (line, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(line)?.[1] ?? null;

/**
 * One body weight from a line of the Health app's export.xml, or null for any other line:
 * { date (the local date it was weighed, from the record's own offset), at (ms), grams }.
 */
export function healthWeightRecord(line) {
  if (!line.includes('HKQuantityTypeIdentifierBodyMass"') || !line.includes('<Record')) return null;
  const value = Number(attr(line, 'value'));
  const unit = attr(line, 'unit');
  const parts = partsFromIso(attr(line, 'startDate'));
  if (!Number.isFinite(value) || value <= 0 || !parts) return null;
  const perUnit = { kg: 1000, g: 1, lb: GRAMS_PER_LB, st: GRAMS_PER_LB * LB_PER_ST }[unit];
  if (!perUnit) return null;
  const grams = Math.round(value * perUnit);
  return grams >= 20_000 && grams <= 400_000 ? { date: parts.date, at: parts.at, grams } : null;
}

/** One reading a day, the latest weighed that day, oldest day first. */
export function latestPerDay(records) {
  const byDate = new Map();
  for (const r of records) if (!byDate.has(r.date) || r.at >= byDate.get(r.date).at) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
