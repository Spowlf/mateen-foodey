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
