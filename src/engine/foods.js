// Your foods: ones you've logged, made or edited. Typed nutrition is converted to integers once, on
// save; a food you edit is marked so a refresh from its source never overwrites it.

import { NUTRIENTS, amountsFor, sumAmounts } from './nutrition.js';
import { isLive } from './entries.js';
import { rankFoods, sourceKey } from './match.js';
import { MAX_GRAMS } from './parse.js';
import { servedAmounts, batchesOf } from './recipes.js';

/** The most a field may hold per 100 g: energy in kcal, nutrients in grams. */
const MAX_KCAL = 900;
const MAX_NUTRIENT_G = 100;

/**
 * A typed number with up to `places` decimals ("11.2", "11,2" or "0.25"), as an integer in 1/10^places,
 * or undefined when it isn't one. Blank is null.
 */
function typedFixed(text, places) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return null;
  const m = new RegExp(`^(\\d+)(?:\\.(\\d{1,${places}}))?$`).exec(t);
  if (!m) return undefined;
  return Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0') || 0);
}

/**
 * Nutrition per 100 g typed on a label: { kcal, protein, carbs, fat, fibre, sugars, salt } as text.
 * kcal is needed; anything else left blank is unknown, never 0.
 * Returns { per100g } or { error } (what to do, as a sentence).
 */
export function per100gFromText(text) {
  const kcalTenths = typedFixed(text.kcal, 1);
  if (kcalTenths === null) return { error: 'Enter the kcal per 100 g.' };
  if (kcalTenths === undefined || kcalTenths > MAX_KCAL * 10) return { error: 'Enter kcal per 100 g from 0 to 900.' };
  const per100g = { kcalTenths };
  for (const n of NUTRIENTS) {
    const mg = typedFixed(text[n], 3);
    if (mg === undefined || mg > MAX_NUTRIENT_G * 1000) return { error: `Enter ${n} in grams per 100 g, from 0 to 100.` };
    per100g[`${n}Mg`] = mg;
  }
  return { per100g };
}

/** Per 100 g as text for editing: "233.5" kcal, "11.2" g. Unknown is blank. */
export function per100gText(per100g) {
  const show = (v, places) => (v == null ? '' : String(v / 10 ** places));
  const out = { kcal: show(per100g?.kcalTenths, 1) };
  for (const n of NUTRIENTS) out[n] = show(per100g?.[`${n}Mg`], 3);
  return out;
}

const samePer100g = (a, b) => ['kcalTenths', ...NUTRIENTS.map((n) => `${n}Mg`)].every((f) => (a?.[f] ?? null) === (b?.[f] ?? null));

/**
 * Servings typed as rows of { label, grams } text. Blank rows are dropped.
 * Returns { servings } or { error }.
 */
export function servingsFromText(rows) {
  const servings = [];
  for (const r of rows) {
    const label = String(r.label ?? '').trim();
    const grams = String(r.grams ?? '').trim();
    if (!label && !grams) continue;
    if (!label) return { error: 'Give each serving a name, like “1 slice”.' };
    if (!/^\d+$/.test(grams) || Number(grams) < 1 || Number(grams) > MAX_GRAMS) return { error: `Enter the grams in ${label}, from 1 to 5,000.` };
    servings.push({ label, grams: Number(grams) });
  }
  return { servings };
}

/** A food you add yourself: a row for the foods table. */
export function customFood({ id, name, brand = null, state = 'asSold', per100g, servings = [], gramsPer100ml = 100 }) {
  return {
    id, name: name.trim(), brand: brand?.trim() || null, barcode: null, state, per100g, carbsIncludeFibre: 0, servings, gramsPer100ml,
    source: 'custom', sourceId: null, fetchedAt: null, assumptions: null, usualGrams: null, useCount: 0, lastUsedAt: null, userEdited: 1, deletedAt: null,
  };
}

/**
 * The fields to save when you edit a food. It's marked edited, so its source never overwrites it.
 * Changing an estimate's nutrition makes it your own food: the figures are yours now, not a guess.
 */
export function editedFood(food, { name, brand = null, state, per100g, servings, gramsPer100ml }) {
  const changes = { name: name.trim(), brand: brand?.trim() || null, state, per100g, servings, gramsPer100ml, userEdited: 1 };
  if (food.source === 'estimate' && !samePer100g(food.per100g, per100g)) Object.assign(changes, { source: 'custom', assumptions: null });
  return changes;
}

/** Your live foods, most used first, then by name; or those matching a search, best first. */
export function myFoods(foods, query = '') {
  const live = foods.filter(isLive);
  if (query.trim()) return rankFoods(query, live);
  return live.sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || a.name.localeCompare(b.name, 'en-GB'));
}

const FOOD_FIELDS = ['name', 'brand', 'barcode', 'state', 'per100g', 'carbsIncludeFibre', 'servings', 'gramsPer100ml', 'source', 'sourceId', 'fetchedAt', 'assumptions'];

/**
 * Makes every line's food one of yours: { foods: the new food rows, lines: each line with its food
 * having an id }. A food that's already yours is used as it is; a source food you already have (same
 * source and id) is reused; anything else becomes a new food, once however many lines name it.
 */
export function adoptFoods({ lines, foods, newId }) {
  const own = new Map(foods.filter((f) => isLive(f) && f.sourceId && f.source !== 'estimate').map((f) => [sourceKey(f), f]));
  const added = [];
  const out = lines.map((line) => {
    if (!line.food || line.food.id) return line;   // a recipe line, or a food that's already yours
    const key = line.food.source !== 'estimate' && line.food.sourceId ? sourceKey(line.food) : null;
    let food = (key && own.get(key)) ?? null;
    if (!food) {
      food = {
        id: newId(), ...Object.fromEntries(FOOD_FIELDS.map((f) => [f, line.food[f] ?? null])),
        servings: line.food.servings ?? [], gramsPer100ml: line.food.gramsPer100ml ?? 100, carbsIncludeFibre: line.food.carbsIncludeFibre ? 1 : 0,
        usualGrams: null, useCount: 0, lastUsedAt: null, userEdited: 0, deletedAt: null,
      };
      added.push(food);
      if (key) own.set(key, food);
    }
    return { ...line, food };
  });
  return { foods: added, lines: out };
}

/**
 * Lines ({ food, grams }, or on a saved meal { recipe, batch, grams }) as stored: [{ foodId, grams }]
 * or [{ recipeId, grams }].
 */
export const storedLines = (lines) => lines.map((l) => (l.recipe ? { recipeId: l.recipe.id, grams: l.grams } : { foodId: l.food.id, grams: l.grams }));

/**
 * Stored lines back as { food, grams } for editing or totals, with the food they name (a deleted
 * food still counts: what you saved keeps working). A saved meal's recipe line comes back as
 * { recipe, batch, grams }, batch its latest (null when it has none). Lines whose food or recipe is
 * missing are left out.
 */
export function linesWithFoods(stored, foods, { recipes = [], batches = [] } = {}) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  return (stored ?? []).flatMap((l) => {
    if (l.recipeId) {
      const recipe = recipeById.get(l.recipeId);
      return recipe ? [{ recipe, batch: batchesOf(batches, recipe.id)[0] ?? null, grams: l.grams, portionBasis: 'typed' }] : [];
    }
    return byId.has(l.foodId) ? [{ food: byId.get(l.foodId), grams: l.grams, portionBasis: 'typed' }] : [];
  });
}

// A line's nutrition (a recipe line's from its batch, null without one) and whether it's "~".
const amountsOf = (l) => (l.recipe ? (l.batch ? servedAmounts(l.batch, l.grams) : null) : amountsFor(l.food.per100g, l.grams, l.food));

const estimatedOf = (l) => (l.recipe ? !!l.batch?.totals.estimated : l.food.source === 'estimate' || l.portionBasis === 'guessed');

/**
 * Lines ({ food, grams }) together: { amounts, estimated }, or null until every line has its grams.
 * Estimated ("~") when any food is an estimate.
 */
export function linesTotal(lines) {
  if (!lines.length || lines.some((l) => !(Number.isInteger(l.grams) && l.grams > 0) || (l.recipe && !l.batch))) return null;
  return {
    amounts: sumAmounts(lines.map(amountsOf)),
    estimated: lines.some(estimatedOf),
  };
}
