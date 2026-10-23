// Meal slots. The slot defaults from the time of day and can be changed on every entry.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

/** The slots the time picks. Snacks come any time of day, so they're only ever picked by hand. */
export const TIMED_MEALS = ['breakfast', 'lunch', 'dinner'];

/** When each timed slot starts (editable in Settings). Before breakfast starts, it's still last night's dinner. */
export const DEFAULT_MEAL_TIMES = Object.freeze({ breakfast: '04:00', lunch: '12:00', dinner: '18:00' });

/** The slot for a local 'HH:MM': the last timed one started by then. */
export function mealForTime(time, times = DEFAULT_MEAL_TIMES) {
  const t = { ...DEFAULT_MEAL_TIMES, ...times };
  let meal = 'dinner';
  for (const m of TIMED_MEALS) if (time >= t[m]) meal = m;
  return meal;
}
