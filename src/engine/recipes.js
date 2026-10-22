// Recipes and batches. A batch is one time a recipe was made: its ingredients' nutrition is copied in,
// so editing a food never changes it. Its totals carry the ingredients' unknowns and estimates.

import { amountsFor, sumAmounts, roundDiv, AMOUNT_FIELDS } from './nutrition.js';
import { isLive } from './entries.js';

/** A batch ingredient: grams of a food, as weighed (raw, cooked or as sold). */
export function batchLine(food, grams) {
  return {
    foodId: food.id ?? null,
    name: food.name,
    state: food.state,
    grams,
    nutrition: amountsFor(food.per100g, grams, food),
    estimated: food.source === 'estimate',
    assumptions: food.assumptions ?? null,
  };
}

/** The batch's totals: the sum of its lines, "~" (estimated) if any line is. */
export function batchTotals(lines) {
  return { ...sumAmounts(lines.map((l) => l.nutrition)), estimated: lines.some((l) => l.estimated) };
}

export const sumGrams = (lines) => lines.reduce((s, l) => s + l.grams, 0);

/**
 * The finished weight: the sum of the ingredients, unless the dish was weighed, less the pot it was
 * weighed in. null when that leaves nothing (weigh it again).
 */
export function finishedGrams({ lines, weighedGrams = null, potGrams = 0 }) {
  const g = weighedGrams == null ? sumGrams(lines) : weighedGrams - (potGrams ?? 0);
  return g > 0 ? g : null;
}

/** Totals × part ÷ whole, field by field; the one rounding before display, in µg and thousandths of a kcal. */
function scale(totals, part, whole) {
  const out = {};
  for (const f of AMOUNT_FIELDS) out[f] = totals[f] == null ? null : roundDiv(totals[f] * part, whole);
  out.partial = [...(totals.partial ?? [])];
  out.carbsIncludeFibre = !!totals.carbsIncludeFibre;
  return out;
}

/** The nutrition of grams served: totals ÷ finished weight × grams. */
export const servedAmounts = (batch, grams) => scale(batch.totals, grams, batch.finishedGrams);

/**
 * Portion n (1 to batch.portions): totals ÷ portions, with any rounding remainder in the last
 * portion, so the portions always add up to the batch. Grams split the same way.
 */
export function portion(batch, n) {
  const count = batch.portions;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(n) || n < 1 || n > count) throw new RangeError('no such portion');
  const share = (v) => {
    if (v == null) return null;
    const each = Math.trunc(v / count);
    return n === count ? v - each * (count - 1) : each;
  };
  const nutrition = {};
  for (const f of AMOUNT_FIELDS) nutrition[f] = share(batch.totals[f]);
  nutrition.partial = [...(batch.totals.partial ?? [])];
  nutrition.carbsIncludeFibre = !!batch.totals.carbsIncludeFibre;
  return { grams: share(batch.finishedGrams), nutrition };
}

/** What's left: the finished weight less what's been logged from it, never below zero. */
export function gramsLeft(batch, entries) {
  const eaten = entries.filter((e) => isLive(e) && e.batchId === batch.id).reduce((s, e) => s + (e.grams ?? 0), 0);
  return Math.max(0, batch.finishedGrams - eaten);
}

/** A batch with nothing left drops off the quick-log chips. */
export const hasLeft = (batch, entries) => gramsLeft(batch, entries) > 0;

/**
 * An entry from a batch: grams served, or one of its portions. Estimated ("~") when an ingredient was,
 * with those ingredients' assumptions copied in.
 */
export function batchEntry({ id, batch, name, grams = null, portionNumber = null, date, meal, createdAt, origin = 'manual' }) {
  const part = portionNumber == null ? { grams, nutrition: servedAmounts(batch, grams) } : portion(batch, portionNumber);
  const assumptions = batch.ingredients.filter((l) => l.estimated && l.assumptions).map((l) => l.assumptions).join(' ') || null;
  return {
    id,
    date,
    meal,
    foodId: null,
    batchId: batch.id,
    name,
    grams: part.grams,
    nutrition: part.nutrition,
    nutritionBasis: batch.totals.estimated ? 'estimate' : 'database',
    portionBasis: portionNumber == null ? 'typed' : 'serving',
    assumptions,
    status: 'logged',
    origin,
    createdAt,
  };
}

/** "Make Again": the last batch's ingredients, for editing. */
export const makeAgain = (batch) => batch.ingredients.map((l) => ({ foodId: l.foodId, grams: l.grams }));
