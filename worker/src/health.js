// POST /health, the Health Shortcut: { date, activeKcal, steps, weightKg, workouts: [{ start, type, minutes, kcal }] }.
// It replaces the date's activity, adds each workout once (its id is its start and type, so running
// the Shortcut again changes nothing), and saves the weight as the day's reading. The date is the phone's.

import { validDate, partsFromIso, formatDayShort, formatWeight } from '../../src/engine/index.js';
import { refuse } from './http.js';
import { settingsOf } from './rows.js';

/** A whole number from a Shortcut's number or text ("9,120", "480.6"), or null. */
function whole(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function syncHealth(ctx, body) {
  if (!validDate(body.date)) throw refuse('send the date from the phone.');
  const { date } = body;
  const activeKcal = whole(body.activeKcal);
  const steps = whole(body.steps);
  // A Shortcut sends an empty Number field as 0, so 0 (like blank) means no weigh-in that day.
  const kg = typeof body.weightKg === 'number' ? body.weightKg : Number(String(body.weightKg ?? '').trim().replace(',', '.') || 0);
  const weightGrams = Number.isFinite(kg) && kg !== 0 ? Math.round(kg * 1000) : null;
  if (weightGrams != null && (weightGrams < 20_000 || weightGrams > 400_000)) throw refuse('send a weight from 20 to 400 kg.');
  if (body.workouts != null && !Array.isArray(body.workouts)) throw refuse('send the workouts as a list.');

  const workouts = [];
  for (const w of body.workouts ?? []) {
    const type = typeof w?.type === 'string' ? w.type.trim() : '';
    const start = typeof w?.start === 'string' ? w.start.trim() : '';
    const minutes = whole(w?.minutes);
    const kcal = whole(w?.kcal);
    if (!type || !start || !(minutes > 0 && minutes <= 1440) || kcal == null) throw refuse('send each workout’s start, type, minutes and kcal.');
    workouts.push({
      id: `health:${start}:${type}`, date: partsFromIso(start)?.date ?? date, start, type, minutes, kcal, source: 'health', activityId: null, deletedAt: null,
    });
  }

  await ctx.store.write({
    activity: [{ id: date, date, activeKcal, steps, source: 'health', deletedAt: null }],
    workouts,
    weights: weightGrams == null ? [] : [{ id: date, date, grams: weightGrams, source: 'health', deletedAt: null }],
  }, ctx.now);

  const { weightUnit } = await settingsOf(ctx.store);
  const parts = [];
  if (activeKcal != null) parts.push(`${activeKcal.toLocaleString('en-GB')} active kcal`);
  if (steps != null) parts.push(`${steps.toLocaleString('en-GB')} ${steps === 1 ? 'step' : 'steps'}`);
  if (weightGrams != null) parts.push(formatWeight(weightGrams, weightUnit));
  if (workouts.length) parts.push(`${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'}`);
  return parts.length ? `Synced ${formatDayShort(date)}: ${parts.join(', ')}.` : `Synced ${formatDayShort(date)}: nothing from Health yet.`;
}
