// Entries: what was eaten, with the food's name, nutrition and assumptions copied at logging and
// never recalculated, so editing a food or recipe never changes past days.

import { amountsFor, sumAmounts } from './nutrition.js';
import { nutritionBasisFor, MAX_GRAMS } from './parse.js';

export const isLive = (r) => !r?.deletedAt;

const checkGrams = (grams) => {
  if (!Number.isInteger(grams) || grams <= 0 || grams > MAX_GRAMS) throw new RangeError('grams must be a whole number from 1 to 5,000');
};

/** An entry for grams of a food. */
export function foodEntry({ id, food, grams, date, meal, portionBasis, origin = 'manual', status = 'logged', createdAt }) {
  checkGrams(grams);
  return {
    id,
    date,
    meal,
    foodId: food.id ?? null,
    batchId: null,
    name: food.name,
    grams,
    nutrition: amountsFor(food.per100g, grams, food),
    nutritionBasis: nutritionBasisFor(food),
    portionBasis,
    assumptions: food.assumptions ?? null,
    status,
    origin,
    createdAt,
  };
}

/** An entry for a number of a food's labelled servings ("2 slices"). */
export function servingEntry({ serving, count = 1, ...rest }) {
  return foodEntry({ ...rest, grams: Math.round(serving.grams * count), portionBasis: 'serving' });
}

/**
 * Quick add: typed kcal, with optional protein, carbs and fat in whole grams. What isn't typed is unknown.
 */
export function quickEntry({ id, date, meal, kcal, proteinG = null, carbsG = null, fatG = null, name = null, createdAt }) {
  if (!Number.isInteger(kcal) || kcal <= 0) throw new RangeError('kcal must be a whole number above zero');
  const g = (v) => (v == null ? null : v * 1_000_000);
  return {
    id,
    date,
    meal,
    foodId: null,
    batchId: null,
    name: name?.trim() || 'Quick add',
    grams: null,
    nutrition: {
      kcalMilli: kcal * 1000, proteinUg: g(proteinG), carbsUg: g(carbsG), fatUg: g(fatG),
      fibreUg: null, sugarsUg: null, saltUg: null, partial: [], carbsIncludeFibre: false,
    },
    nutritionBasis: 'quick',
    portionBasis: null,
    assumptions: null,
    status: 'logged',
    origin: 'quick',
    createdAt,
  };
}

/** Live entries on a date. */
export const entriesOn = (entries, date) => entries.filter((e) => isLive(e) && e.date === date);

/** A day's nutrition: every live entry, To check ones included. */
export const dayTotal = (entries, date) => sumAmounts(entriesOn(entries, date).map((e) => e.nutrition));

/** Is an entry an estimate in any way: To check, estimated nutrition or a guessed portion. */
export const isEstimated = (e) => e.status === 'toCheck' || e.nutritionBasis === 'estimate' || e.portionBasis === 'guessed';

/** Food memory after a log: the usual portion is the last one logged. */
export const foodMemory = (food, grams, now) => ({ usualGrams: grams, useCount: (food.useCount ?? 0) + 1, lastUsedAt: now });

/** Millilitres to grams with the food's density (gramsPer100ml, 100 for water). */
export const mlToGrams = (ml, gramsPer100ml = 100) => Math.round((ml * gramsPer100ml) / 100);
