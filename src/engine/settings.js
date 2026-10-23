// Settings: their defaults and what each may hold. The Worker checks every save with these, and
// Settings on the phone checks them before sending, so both say the same thing.

import { TIMED_MEALS, DEFAULT_MEAL_TIMES } from './meals.js';
import { DEFAULT_FLOOR_KCAL, DEFAULT_ADD_BACK_PCT, GOAL_RATES_G, adaptiveKcal } from './targets.js';

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const validTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** The defaults written once, on the first request. */
export const DEFAULT_SETTINGS = Object.freeze({
  floorKcal: DEFAULT_FLOOR_KCAL,
  exerciseAddBackPct: DEFAULT_ADD_BACK_PCT,
  mealTimes: { ...DEFAULT_MEAL_TIMES },
  weightUnit: 'kg',
  sources: { off: true, cofid: true, usda: true },
});

// What's wrong with each setting's value, as the end of "Nothing changed: …", or null.
const CHECKS = {
  floorKcal: (v) => (int(v, 800, 4000) ? null : 'enter a floor from 800 to 4,000 kcal.'),
  exerciseAddBackPct: (v) => (int(v, 0, 100) ? null : 'enter a share from 0 to 100%.'),
  mealTimes: (v) => {
    const times = TIMED_MEALS.map((m) => v?.[m]);
    if (!times.every(validTime)) return 'enter each meal time as hours and minutes.';
    return times.every((t, i) => i === 0 || t > times[i - 1]) ? null : 'put the meal times in order through the day.';
  },
  weightUnit: (v) => (v === 'kg' || v === 'stlb' ? null : 'pick kg or st lb.'),
  sources: (v) => (v && ['off', 'cofid', 'usda'].every((s) => typeof v[s] === 'boolean') ? null : 'turn each food source on or off.'),
};

/** What's wrong with a setting, or null when it can be saved. */
export const settingProblem = (id, value) => (CHECKS[id] ? CHECKS[id](value) : 'that setting doesn’t exist.');

/** A whole number typed in a box, or null. */
export const typedWhole = (text) => (/^\d+$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null);

/**
 * The targets row saved from Settings, from fromDate on: { row } or { error }. Fixed takes the typed
 * kcal. Adaptive takes the maintenance estimate ± the goal rate when the estimate is ready, and the
 * typed kcal until then. Protein is needed; carbs and fat are optional.
 */
export function targetFromSettings({ fromDate, mode, kcalText, proteinText, carbsText, fatText, goalRateG, estimate, floorKcal = DEFAULT_FLOOR_KCAL }) {
  if (!GOAL_RATES_G.includes(goalRateG)) return { error: 'Pick a goal.' };
  let kcal = typedWhole(kcalText);
  if (mode === 'adaptive' && estimate?.ok) kcal = adaptiveKcal({ maintenanceKcal: estimate.kcal, goalRateG, floorKcal });
  if (kcal == null || kcal < 500 || kcal > 10_000) return { error: 'Enter a daily target from 500 to 10,000 kcal.' };
  const grams = (text, required) => {
    const g = typedWhole(text);
    if (g == null) return String(text ?? '').trim() || required ? undefined : null;
    return g <= 1000 ? g : undefined;
  };
  const proteinG = grams(proteinText, true);
  const carbsG = grams(carbsText, false);
  const fatG = grams(fatText, false);
  if (proteinG === undefined) return { error: 'Enter a protein target from 0 to 1,000 g.' };
  if (carbsG === undefined || fatG === undefined) return { error: 'Enter carbs and fat from 0 to 1,000 g, or leave them blank.' };
  return { row: { id: fromDate, fromDate, mode, kcal, proteinG, carbsG, fatG, goalRateG, deletedAt: null } };
}
