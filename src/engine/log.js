// The Log screen's rules: quick-log chips, To check, the check sheet's lines and what "Log 3 Items" saves.

import { addDays, today, nowTime, formatDay } from './dates.js';
import { amountsFor, kcalOf, gramsOf, formatKcal, formatGrams } from './nutrition.js';
import { foodEntry, isLive, dayTotal } from './entries.js';
import { hasLeft } from './recipes.js';
import { MAX_GRAMS } from './parse.js';
import { adoptFoods } from './foods.js';
import { titleCase } from './text.js';

export const QUICK_LOG_DAYS = 90;

export const BATCH_CHIP_DAYS = 14;

/**
 * Quick-log chips: batches made in the last 14 days with something left (newest first), then your
 * foods and saved meals together, most logged in this meal slot first, then most logged in the last
 * 90 days, then most recent, then by name. A saved meal counts once each time it's logged, however
 * many items it has; one never logged yet still shows. Each is
 * { kind: 'batch', batch, recipe } | { kind: 'meal', savedMeal } | { kind: 'food', food, grams }.
 */
export function quickLogItems({ entries, foods, savedMeals = [], batches = [], recipes = [], meal, today, n = 8 }) {
  const fromBatch = addDays(today, -BATCH_CHIP_DAYS);
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const batchChips = batches
    .filter((b) => isLive(b) && b.date >= fromBatch && b.date <= today && recipeById.has(b.recipeId) && hasLeft(b, entries))
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.updatedAt ?? 0) - (a.updatedAt ?? 0)))
    .map((batch) => ({ kind: 'batch', batch, recipe: recipeById.get(batch.recipeId), key: batch.id }));

  const from = addDays(today, -QUICK_LOG_DAYS);
  const inSlot = new Map();
  const all = new Map();
  const last = new Map();
  const counted = new Set();
  const count = (key, e) => {
    all.set(key, (all.get(key) ?? 0) + 1);
    if (e.meal === meal) inSlot.set(key, (inSlot.get(key) ?? 0) + 1);
    last.set(key, Math.max(last.get(key) ?? 0, e.createdAt ?? 0));
  };
  for (const e of entries) {
    if (!isLive(e) || e.status !== 'logged' || e.date < from || e.date > today) continue;
    if (e.savedMealId) {
      const once = `${e.savedMealId}|${e.date}|${e.createdAt}`;
      if (!counted.has(once)) { counted.add(once); count(`meal:${e.savedMealId}`, e); }
    } else if (e.foodId && !e.batchId) count(`food:${e.foodId}`, e);
  }
  const others = [
    ...foods.filter((f) => isLive(f) && all.has(`food:${f.id}`) && f.usualGrams > 0)
      .map((food) => ({ kind: 'food', food, grams: food.usualGrams, key: `food:${food.id}`, name: food.name, lastUsed: food.lastUsedAt ?? 0 })),
    ...savedMeals.filter((m) => isLive(m) && m.items?.length)
      .map((savedMeal) => ({ kind: 'meal', savedMeal, key: `meal:${savedMeal.id}`, name: savedMeal.name, lastUsed: last.get(`meal:${savedMeal.id}`) ?? 0 })),
  ].sort((a, b) => (inSlot.get(b.key) ?? 0) - (inSlot.get(a.key) ?? 0)
    || (all.get(b.key) ?? 0) - (all.get(a.key) ?? 0)
    || b.lastUsed - a.lastUsed
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...batchChips, ...others].slice(0, n).map(({ key, name, lastUsed, ...item }) => item);
}

/** To check entries (saved by a Shortcut or left unconfirmed), newest first. */
export const toCheckEntries = (entries) => entries
  .filter((e) => isLive(e) && e.status === 'toCheck')
  .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt ?? 0) - (a.createdAt ?? 0)));

/** A line's nutrition for its grams, or null until it has a food and grams. */
export const lineAmounts = (line) => (line.food && line.grams > 0 ? amountsFor(line.food.per100g, line.grams, line.food) : null);

/** Is a line's nutrition an estimate in any way: estimated food or guessed portion. */
export const lineEstimated = (line) => line.food?.source === 'estimate' || line.portionBasis === 'guessed';

/** "312 kcal, 20 g protein" for an amount, with "~" when estimated. Unknown parts are left out. */
export function figuresText(amounts, { estimated = false } = {}) {
  if (!amounts) return '';
  const t = estimated ? '~' : '';
  const kcal = kcalOf(amounts.kcalMilli);
  const parts = [kcal == null ? 'kcal unknown' : `${t}${formatKcal(kcal)}`];
  for (const [field, word] of [['proteinUg', 'protein'], ['carbsUg', 'carbs'], ['fatUg', 'fat']]) {
    const g = gramsOf(amounts[field]);
    if (g != null) parts.push(formatGrams(g, word));
  }
  return parts.join(', ');
}

/**
 * The check sheet's button: "Log 3 Items" (or "Add 3 Items" with verb 'add'), or what's missing
 * ("Pick a Food for Haggis", "Enter the Grams").
 */
export function checkButton(lines, verb = 'log') {
  if (!lines.length) return { ready: false, label: 'Add a Food' };
  const unmatched = lines.find((l) => !l.food);
  if (unmatched) return { ready: false, label: titleCase(`pick a food for ${unmatched.name}`) };
  if (lines.some((l) => !(Number.isInteger(l.grams) && l.grams > 0 && l.grams <= MAX_GRAMS))) return { ready: false, label: 'Enter the Grams' };
  return { ready: true, label: titleCase(`${verb} ${lines.length} ${lines.length === 1 ? 'item' : 'items'}`) };
}

/**
 * What logging lines saves: { foods, entries }. Each line's food becomes one of yours (see
 * adoptFoods), and each entry copies its food's name, nutrition and assumptions. newId() gives fresh
 * ids. savedMealId marks entries logged from a saved meal.
 */
export function logLines({ lines, foods, date, meal, origin = 'manual', newId, now, savedMealId = null }) {
  const adopted = adoptFoods({ lines, foods, newId });
  const entries = adopted.lines.map((line) => foodEntry({
    id: newId(), food: line.food, grams: line.grams, date, meal, portionBasis: line.portionBasis ?? 'typed', origin, createdAt: now, savedMealId,
  }));
  return { foods: adopted.foods, entries };
}

/** With no target set: "1,240 kcal eaten today." */
export function eatenLine(entries, date) {
  const kcal = kcalOf(dayTotal(entries, date).kcalMilli) ?? 0;
  return `${formatKcal(kcal)} eaten today.`;
}

/** "Breakfast" */
export const mealName = (meal) => titleCase(meal);

/**
 * The grams being typed on the number pad, as text: digits only, no leading zero, at most 5,000.
 * key is '0'–'9' or 'back'. A key that would go past 5,000 is ignored.
 */
export function pressGramsKey(text, key) {
  if (key === 'back') return text.slice(0, -1);
  if (!/^\d$/.test(key)) return text;
  const next = text === '0' ? key : text + key;
  return Number(next) > MAX_GRAMS ? text : next;
}

/** Whole grams from typed text, or null when there are none. */
export const typedGrams = (text) => (/^\d+$/.test(text ?? '') && Number(text) > 0 ? Number(text) : null);

/** "Last synced today at 08:15" / "Last synced 30 Sep 2026 at 08:15" / "Not synced yet". */
export function syncedPhrase(ms, now = new Date()) {
  if (!ms) return 'Not synced yet';
  const d = new Date(ms);
  const day = today(d);
  return `Last synced ${day === today(now) ? 'today' : formatDay(day)} at ${nowTime(d)}`;
}
