// Daily targets. Each targets row applies from its fromDate (its id) until the next one, so changing
// a target never rewrites past days. A target never goes below the floor.
// Fixed: a typed target, with a share of the day's exercise added back.
// Adaptive: maintenance ± goal rate × 7,700 ÷ 7, changed only when you accept it in the weekly review.
// Exercise isn't added back, because the maintenance estimate already includes it.

import { isLive } from './entries.js';

/** Goal rates in grams a week: lose 0.75, 0.5 or 0.25 kg, maintain, or gain 0.25 kg. No faster rate. */
export const GOAL_RATES_G = [-750, -500, -250, 0, 250];
export const DEFAULT_FLOOR_KCAL = 1500;
export const DEFAULT_ADD_BACK_PCT = 50;

/** The targets row that applies on date: the latest one from on or before it. */
export function targetRowFor(targets, date) {
  let best = null;
  for (const t of targets) if (isLive(t) && t.fromDate <= date && (!best || t.fromDate > best.fromDate)) best = t;
  return best;
}

/** The daily change for a goal rate: g a week × 7,700 kcal a kg ÷ 7 days (−500 g → −550 kcal). */
export const dailyChangeKcal = (goalRateG) => Math.round((goalRateG * 11) / 10);

/** An adaptive target from the maintenance estimate, never below the floor. */
export function adaptiveKcal({ maintenanceKcal, goalRateG, floorKcal = DEFAULT_FLOOR_KCAL }) {
  return Math.max(floorKcal, maintenanceKcal + dailyChangeKcal(goalRateG));
}

/**
 * A day's target: { kcal, baseKcal, addBackKcal, proteinG, carbsG, fatG, mode, goalRateG }, or null with
 * no target set. Fixed mode adds back exerciseAddBackPct of the day's exercise; adaptive adds none.
 */
export function dayTarget({ targets, date, settings = {}, exerciseKcal = 0 }) {
  const row = targetRowFor(targets, date);
  if (!row) return null;
  const floor = settings.floorKcal ?? DEFAULT_FLOOR_KCAL;
  const pct = settings.exerciseAddBackPct ?? DEFAULT_ADD_BACK_PCT;
  const baseKcal = Math.max(floor, row.kcal);
  const addBackKcal = row.mode === 'fixed' ? Math.round((exerciseKcal * pct) / 100) : 0;
  return {
    kcal: baseKcal + addBackKcal,
    baseKcal,
    addBackKcal,
    proteinG: row.proteinG ?? null,
    carbsG: row.carbsG ?? null,
    fatG: row.fatG ?? null,
    mode: row.mode,
    goalRateG: row.goalRateG ?? 0,
  };
}

/** The row written when you accept a new target ("Use 2,050 kcal"): the current one with a new kcal, from fromDate on. */
export function acceptedTarget(current, { kcal, fromDate }) {
  return { ...current, id: fromDate, fromDate, kcal };
}
