// Exercise energy. Everything here is net energy, above resting: the same basis as Apple Health's
// active energy.

import { isLive } from './entries.js';

/** Net kcal for an activity: (MET − 1) × body kg × hours, whole kcal. */
export function metKcal({ met, weightGrams, minutes }) {
  if (!(met > 1) || !(weightGrams > 0) || !(minutes > 0)) return 0;
  return Math.round(((met - 1) * weightGrams * minutes) / 60000);
}

/** The latest weight on or before date, in grams, or null. */
export function latestWeight(weights, date) {
  let best = null;
  for (const w of weights) if (isLive(w) && w.date <= date && (!best || w.date > best.date)) best = w;
  return best?.grams ?? null;
}

/**
 * A day's exercise: Health's active energy when the day has it (it already counts every workout, so
 * manual ones aren't added), else the day's workouts. Manual workouts are estimates ("~").
 * Returns { kcal, source: 'health' | 'workouts' | null, estimated }.
 */
export function dayExercise({ activity = [], workouts = [], date }) {
  const day = activity.find((a) => isLive(a) && a.date === date && a.activeKcal != null);
  if (day) return { kcal: day.activeKcal, source: 'health', estimated: false };
  const own = workouts.filter((w) => isLive(w) && w.date === date);
  if (!own.length) return { kcal: 0, source: null, estimated: false };
  return { kcal: own.reduce((s, w) => s + (w.kcal ?? 0), 0), source: 'workouts', estimated: own.some((w) => w.source === 'manual') };
}

/** "~240 kcal: (4.8 MET − 1) × 72.4 kg × 0.5 h." How a manual workout's kcal are counted. */
export function metText({ met, weightGrams, minutes }) {
  const kcal = metKcal({ met, weightGrams, minutes });
  const kg = (Math.round(weightGrams / 100) / 10).toLocaleString('en-GB');
  const hours = (Math.round((minutes / 60) * 100) / 100).toLocaleString('en-GB');
  return `~${kcal.toLocaleString('en-GB')} kcal: (${met.toLocaleString('en-GB')} MET − 1) × ${kg} kg × ${hours} h.`;
}

/**
 * A workout you add yourself: an activity from data/activities.json and minutes, at your latest
 * weight. Its kcal are an estimate ("~"). Returns { row } or { error } (what to do, as a sentence).
 */
export function manualWorkout({ id, date, activity, minutes, weightGrams }) {
  if (!activity) return { error: 'Pick an activity.' };
  if (!(weightGrams > 0)) return { error: 'Add a weight first: the kcal depend on it.' };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return { error: 'Enter minutes from 1 to 1,440.' };
  return {
    row: {
      id, date, start: null, type: activity.name, minutes, kcal: metKcal({ met: activity.met, weightGrams, minutes }),
      source: 'manual', activityId: activity.id, deletedAt: null,
    },
  };
}

/** A day's live workouts, Health's first, then in the order added. */
export const workoutsOn = (workouts, date) => workouts
  .filter((w) => isLive(w) && w.date === date)
  .sort((a, b) => (a.source === b.source ? (a.start ?? '').localeCompare(b.start ?? '') : a.source === 'health' ? -1 : 1));
