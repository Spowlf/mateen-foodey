// Recipes and batches. A batch is one time a recipe was made: its ingredients' nutrition is copied in,
// so editing a food never changes it. Its totals carry the ingredients' unknowns and estimates.

import { amountsFor, sumAmounts, roundDiv, AMOUNT_FIELDS, formatGrams } from './nutrition.js';
import { isLive } from './entries.js';
import { MAX_GRAMS } from './parse.js';

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

/**
 * The dish split into equal servings, for each count: grams and nutrition of one serving
 * (weight and totals ÷ count, each rounded once).
 */
export const servingSplits = (totals, grams, counts = [3, 4, 5]) =>
  counts.map((count) => ({ count, grams: roundDiv(grams, count), nutrition: scale(totals, 1, count) }));

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
 * Portions from to from + count − 1 together: grams and nutrition, each portion split as portion() does,
 * so the remainder still lands in the last.
 */
export function portions(batch, from, count = 1) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('no such portion');
  const parts = Array.from({ length: count }, (_, i) => portion(batch, from + i));
  const nutrition = {};
  for (const f of AMOUNT_FIELDS) nutrition[f] = batch.totals[f] == null ? null : parts.reduce((s, p) => s + p.nutrition[f], 0);
  nutrition.partial = [...(batch.totals.partial ?? [])];
  nutrition.carbsIncludeFibre = !!batch.totals.carbsIncludeFibre;
  return { grams: parts.reduce((s, p) => s + p.grams, 0), nutrition };
}

/**
 * How many portions have been logged from a batch: each live entry logged by portion counts as its
 * grams over a portion's weight, at least one.
 */
export function portionsLogged(batch, entries) {
  if (!batch.portions) return 0;
  const each = batch.finishedGrams / batch.portions;
  return entries
    .filter((e) => isLive(e) && e.batchId === batch.id && e.portionBasis === 'serving')
    .reduce((n, e) => n + Math.max(1, Math.round((e.grams ?? 0) / each)), 0);
}

/** Portions not logged yet (0 when the batch isn't split into portions). */
export const portionsLeft = (batch, entries) => (batch.portions ? Math.max(0, batch.portions - portionsLogged(batch, entries)) : 0);

/**
 * An entry from a batch: grams served, or count portions starting at portionNumber. Estimated ("~")
 * when an ingredient was, with those ingredients' assumptions copied in.
 */
export function batchEntry({ id, batch, name, grams = null, portionNumber = null, portionCount = 1, date, meal, createdAt, origin = 'manual' }) {
  const part = portionNumber == null ? { grams, nutrition: servedAmounts(batch, grams) } : portions(batch, portionNumber, portionCount);
  const assumptions = batch.ingredients.filter((l) => l.estimated && l.assumptions).map((l) => l.assumptions).join(' ') || null;
  return {
    id,
    date,
    meal,
    foodId: null,
    batchId: batch.id,
    savedMealId: null,
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

/**
 * A batch, one time a recipe is made: lines are { food, grams } with every food one of yours.
 * The finished weight is the lines' sum, or weighedGrams less the pot's grams. portions is optional.
 * Returns { batch } or { error } (what to do, as a sentence).
 */
export function makeBatch({ id, recipeId, date, lines, weighedGrams = null, pot = null, portions: count = null }) {
  if (!lines.length) return { error: 'Add an ingredient.' };
  if (lines.some((l) => !(Number.isInteger(l.grams) && l.grams > 0 && l.grams <= MAX_GRAMS))) return { error: 'Enter the grams of each ingredient.' };
  const ingredients = lines.map((l) => batchLine(l.food, l.grams));
  const finished = finishedGrams({ lines: ingredients, weighedGrams, potGrams: pot?.grams ?? 0 });
  if (finished == null) return { error: 'The dish weighs less than the pot. Weigh it again.' };
  if (count != null && !(Number.isInteger(count) && count >= 1 && count <= 100)) return { error: 'Enter 1 to 100 portions, or leave it blank.' };
  return {
    batch: {
      id, recipeId, date, ingredients, totals: batchTotals(ingredients), weighedGrams: weighedGrams ?? null, potId: weighedGrams == null ? null : pot?.id ?? null,
      finishedGrams: finished, portions: count ?? null, deletedAt: null,
    },
  };
}

/** A recipe's live batches, newest first. */
export const batchesOf = (batches, recipeId) => batches
  .filter((b) => isLive(b) && b.recipeId === recipeId)
  .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));

/** "~1,050 g left": the finished weight is weighed or summed, and what's eaten may not all be logged. */
export const leftText = (batch, entries) => `~${formatGrams(gramsLeft(batch, entries))} left`;

/** "Make Again": the last batch's ingredients, for editing. */
export const makeAgain = (batch) => batch.ingredients.map((l) => ({ foodId: l.foodId, grams: l.grams }));

/** What making a recipe starts from: the last batch's ingredients, or the recipe's own the first time. */
export function nextIngredients(recipe, batches) {
  const last = batchesOf(batches, recipe.id)[0];
  return last ? makeAgain(last) : recipe.ingredients;
}
