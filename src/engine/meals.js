// Meal slots. The slot defaults from the time of day and can be changed on every entry.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

/** When each slot starts (editable in Settings). Before breakfast starts, it's still last night's snacks. */
export const DEFAULT_MEAL_TIMES = Object.freeze({ breakfast: '04:00', lunch: '11:00', dinner: '17:00', snacks: '21:00' });

/** The slot for a local 'HH:MM': the last one started by then. */
export function mealForTime(time, times = DEFAULT_MEAL_TIMES) {
  const t = { ...DEFAULT_MEAL_TIMES, ...times };
  let meal = 'snacks';
  for (const m of MEALS) if (time >= t[m]) meal = m;
  return meal;
}
