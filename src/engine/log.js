// The Log screen's rules: quick-log chips, To check, the check sheet's lines and what "Log 3 Items" saves.

import { addDays, today, nowTime, formatDay } from './dates.js';
import { amountsFor, kcalOf, gramsOf, formatKcal, formatGrams } from './nutrition.js';
import { foodEntry, isLive, dayTotal } from './entries.js';
import { MAX_GRAMS } from './parse.js';
import { sourceKey } from './match.js';
import { titleCase } from './text.js';

export const QUICK_LOG_DAYS = 90;

/**
 * Quick-log chips: foods you've logged in the last 90 days, most logged in this meal slot first,
 * then most logged overall, then most recent, then by name. Each is { food, grams } at its usual portion.
 */
export function quickLogFoods({ entries, foods, meal, today, n = 8 }) {
  const from = addDays(today, -QUICK_LOG_DAYS);
  const inSlot = new Map();
  const all = new Map();
  for (const e of entries) {
    if (!isLive(e) || e.status !== 'logged' || !e.foodId || e.date < from || e.date > today) continue;
    all.set(e.foodId, (all.get(e.foodId) ?? 0) + 1);
    if (e.meal === meal) inSlot.set(e.foodId, (inSlot.get(e.foodId) ?? 0) + 1);
  }
  return foods
    .filter((f) => isLive(f) && all.has(f.id) && f.usualGrams > 0)
    .sort((a, b) => (inSlot.get(b.id) ?? 0) - (inSlot.get(a.id) ?? 0)
      || all.get(b.id) - all.get(a.id)
      || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
      || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, n)
    .map((food) => ({ food, grams: food.usualGrams }));
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

/** The check sheet's button: "Log 3 Items", or what's missing ("Pick a Food for Haggis", "Enter the Grams"). */
export function checkButton(lines) {
  if (!lines.length) return { ready: false, label: 'Add a Food' };
  const unmatched = lines.find((l) => !l.food);
  if (unmatched) return { ready: false, label: titleCase(`pick a food for ${unmatched.name}`) };
  if (lines.some((l) => !(Number.isInteger(l.grams) && l.grams > 0 && l.grams <= MAX_GRAMS))) return { ready: false, label: 'Enter the Grams' };
  return { ready: true, label: titleCase(`log ${lines.length} ${lines.length === 1 ? 'item' : 'items'}`) };
}

const FOOD_FIELDS = ['name', 'brand', 'barcode', 'state', 'per100g', 'carbsIncludeFibre', 'servings', 'gramsPer100ml', 'source', 'sourceId', 'fetchedAt', 'assumptions'];

/**
 * What logging lines saves: { foods, entries }. A line's food that's already yours is used as it is;
 * a source food you already have (same source and id) is reused; anything else becomes a new food.
 * Each entry copies its food's name, nutrition and assumptions. newId() gives fresh ids.
 */
export function logLines({ lines, foods, date, meal, origin = 'manual', newId, now }) {
  const own = new Map(foods.filter((f) => isLive(f) && f.sourceId && f.source !== 'estimate').map((f) => [sourceKey(f), f]));
  const added = [];
  const entries = lines.map((line) => {
    let food = line.food;
    if (!food.id) {
      const key = food.source !== 'estimate' && food.sourceId ? sourceKey(food) : null;
      food = (key && own.get(key)) ?? null;
      if (!food) {
        food = {
          id: newId(), ...Object.fromEntries(FOOD_FIELDS.map((f) => [f, line.food[f] ?? null])),
          servings: line.food.servings ?? [], gramsPer100ml: line.food.gramsPer100ml ?? 100, carbsIncludeFibre: line.food.carbsIncludeFibre ? 1 : 0,
          usualGrams: null, useCount: 0, lastUsedAt: null, userEdited: 0, deletedAt: null,
        };
        added.push(food);
        if (key) own.set(key, food);
      }
    }
    return foodEntry({ id: newId(), food, grams: line.grams, date, meal, portionBasis: line.portionBasis ?? 'typed', origin, createdAt: now });
  });
  return { foods: added, entries };
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
