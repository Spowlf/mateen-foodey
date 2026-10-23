// Saving and deleting synced rows, and the first-run seed.
// Every save is a PUT of a row with its client-generated id (or a POST /batch of several), so a
// retry after an uncertain failure writes the same row again and never adds a second one.

import {
  TABLES, SYNCED, REFERENCES, validDate, MEALS, GOAL_RATES_G, MAX_GRAMS, NUTRIENTS, AMOUNT_FIELDS, foodMemory, DEFAULT_SETTINGS, settingProblem,
} from '../../src/engine/index.js';
import { refuse } from './http.js';

const MAX_BATCH_ROWS = 500;
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const intOrNull = (v, min, max) => v === null || v === undefined || int(v, min, max);
const oneOf = (...values) => (v) => values.includes(v);
const PER100G_FIELDS = ['kcalTenths', ...NUTRIENTS.map((n) => `${n}Mg`)];

/** Per 100 g: each field a whole number (kcal up to 900, nutrients up to 100 g) or null. */
const validPer100g = (p) => p && typeof p === 'object' && PER100G_FIELDS.every((f) => intOrNull(p[f], 0, f === 'kcalTenths' ? 9000 : 100_000));

/** Nutrition of an amount: each field a whole number or null (see src/engine/nutrition.js). */
const validAmounts = (a) => a && typeof a === 'object' && AMOUNT_FIELDS.every((f) => intOrNull(a[f], 0, Number.MAX_SAFE_INTEGER));

/** Lines naming a food and its grams: recipe ingredients, saved meal items, batch ingredients. */
const validLines = (lines) => Array.isArray(lines) && lines.every((l) => l && typeof l.foodId === 'string' && int(l.grams, 1, MAX_GRAMS));

/** A saved meal's items: each a food or a recipe (served from its latest batch), with its grams. */
const validItems = (items) => Array.isArray(items) && items.every((l) => l && (typeof l.foodId === 'string') !== (typeof l.recipeId === 'string') && int(l.grams, 1, MAX_GRAMS));

export { DEFAULT_SETTINGS };

/** What's wrong with a live row, as the end of "Nothing changed: …", or null. */
function check(name, row) {
  if (row.deletedAt) return null;
  if (TABLES[name].required.some((f) => blank(row[f]))) return 'fill in every field.';
  switch (name) {
    case 'foods':
      if (!oneOf('raw', 'cooked', 'asSold')(row.state)) return 'pick raw, cooked or as sold.';
      if (!oneOf('off', 'cofid', 'usda', 'custom', 'estimate')(row.source)) return 'pick where the food comes from.';
      if (!validPer100g(row.per100g)) return 'enter nutrition per 100 g from 0 to 100 g, and energy up to 900 kcal.';
      if (!Array.isArray(row.servings) || !row.servings.every((s) => s && !blank(s.label) && int(s.grams, 1, MAX_GRAMS))) return 'give each serving a name and its grams.';
      if (!int(row.gramsPer100ml, 1, 300)) return 'enter how many grams 100 ml weighs.';
      return null;
    case 'entries':
      if (!validDate(row.date)) return 'pick the date.';
      if (!MEALS.includes(row.meal)) return 'pick a meal.';
      if (!intOrNull(row.grams, 1, MAX_GRAMS)) return 'enter grams from 1 to 5,000.';
      if (!validAmounts(row.nutrition)) return 'the nutrition is incomplete. Log it again.';
      if (!oneOf('database', 'estimate', 'quick')(row.nutritionBasis)) return 'the nutrition is incomplete. Log it again.';
      if (row.portionBasis != null && !oneOf('weighed', 'typed', 'serving', 'guessed')(row.portionBasis)) return 'enter the grams.';
      if (!oneOf('logged', 'toCheck')(row.status) || !oneOf('manual', 'sentence', 'photo', 'shortcut', 'quick')(row.origin)) return 'log it again.';
      return null;
    case 'savedMeals':
      return validItems(row.items) && row.items.length ? null : 'add at least one food or recipe, each with its grams.';
    case 'recipes':
      return validLines(row.ingredients) ? null : 'give each ingredient its grams.';
    case 'batches':
      if (!validDate(row.date)) return 'pick the date it was made.';
      if (!validLines(row.ingredients) || !row.ingredients.length) return 'give each ingredient its grams.';
      if (!validAmounts(row.totals)) return 'the nutrition is incomplete. Make it again.';
      if (!int(row.finishedGrams, 1, 100_000)) return 'enter a finished weight above zero.';
      if (!intOrNull(row.weighedGrams, 1, 100_000)) return 'enter the weighed grams.';
      if (!intOrNull(row.portions, 1, 100)) return 'enter 1 to 100 portions.';
      return null;
    case 'pots':
      return int(row.grams, 0, 20_000) ? null : 'enter the pot’s weight in grams.';
    case 'days':
      if (!validDate(row.id)) return 'pick the day.';
      return oneOf('complete', 'incomplete')(row.state) ? null : 'mark the day complete or incomplete.';
    case 'targets':
      if (!validDate(row.fromDate) || row.id !== row.fromDate) return 'pick the date the target starts.';
      if (!oneOf('fixed', 'adaptive')(row.mode)) return 'pick fixed or adaptive.';
      if (!int(row.kcal, 500, 10_000)) return 'enter a target from 500 to 10,000 kcal.';
      if (![row.proteinG, row.carbsG, row.fatG].every((g) => intOrNull(g, 0, 1000))) return 'enter grams from 0 to 1,000.';
      return row.goalRateG == null || GOAL_RATES_G.includes(row.goalRateG) ? null : 'pick a goal from the list.';
    case 'weights':
      if (!validDate(row.date) || row.id !== row.date) return 'pick the date of the weigh-in.';
      if (!int(row.grams, 20_000, 400_000)) return 'enter a weight from 20 to 400 kg.';
      return oneOf('manual', 'health', 'import')(row.source) ? null : 'log the weight again.';
    case 'workouts':
      if (!validDate(row.date)) return 'pick the date.';
      if (!int(row.minutes, 1, 1440)) return 'enter minutes from 1 to 1,440.';
      if (!int(row.kcal, 0, 10_000)) return 'enter kcal from 0 to 10,000.';
      return oneOf('health', 'manual')(row.source) ? null : 'log the workout again.';
    case 'reviews':
      if (!validDate(row.weekStart) || row.id !== row.weekStart) return 'pick the week.';
      return Number.isInteger(row.completedAt) ? null : 'finish the review again.';
    case 'settings':
      return settingProblem(row.id, row.value);
    default:
      return null;
  }
}

/** Names are stored without stray spaces. */
function tidy(row) {
  for (const f of ['name', 'brand', 'assumptions']) if (typeof row[f] === 'string') row[f] = row[f].trim() || null;
  if (Array.isArray(row.servings)) row.servings = row.servings.map((s) => ({ ...s, label: String(s?.label ?? '').trim() }));
}

/** The stored row with the fields sent laid over it (a new row starts from the table's defaults). */
async function merged(store, name, id, body) {
  const { fields, defaults } = TABLES[name];
  const existing = await store.get(name, id);
  const row = existing ? { ...existing } : { id, deletedAt: null, ...structuredClone(defaults) };
  for (const f of [...fields, 'deletedAt']) if (f in body) row[f] = body[f] ?? null;
  tidy(row);
  return { existing, row };
}

/** A body whose id differs from the address is refused, so a row is never saved under the wrong id. */
export function sameId(id, body) {
  if (body && 'id' in body && body.id !== id) throw refuse('the record’s id doesn’t match its address.');
}

/** PUT /:table/:id: add a row, or change the fields sent (others are kept). */
export async function saveRow(ctx, name, id, body) {
  sameId(id, body);
  return saveBatch(ctx, { [name]: [{ ...body, id }] });
}

/**
 * Food memory: an entry that becomes logged (new, or confirmed from To check) updates its food's
 * usual grams, use count and last use, in the same write. A retry of the same save changes nothing more.
 */
function remember(entry, existing, foods, now) {
  if (entry.deletedAt || entry.status !== 'logged' || !entry.foodId || entry.grams == null) return false;
  if (existing && existing.status === 'logged') return false;
  const food = foods.get(entry.foodId);
  if (!food || food.deletedAt) return false;
  Object.assign(food, foodMemory(food, entry.grams, now));
  return true;
}

/**
 * POST /batch { foods?: [row], entries?: [row], ... }: rows of any tables the app writes, in one
 * write, all or nothing ("Log 3 Items" saves new foods and their entries together). Each row has
 * its id and the fields to change. Every food, batch, recipe and pot a live row names must exist,
 * in the batch or already saved, so a backup of the data always restores.
 */
export async function saveBatch(ctx, body) {
  const { store } = ctx;
  const names = Object.keys(body ?? {});
  if (!names.length) throw refuse('send at least one row.');
  for (const name of names) {
    if (!TABLES[name]?.clientWrites) throw refuse(`${name} can’t be saved here.`, 404);
    if (!Array.isArray(body[name])) throw refuse('send a list of rows.');
  }
  if (names.reduce((n, name) => n + body[name].length, 0) > MAX_BATCH_ROWS) throw refuse(`send at most ${MAX_BATCH_ROWS} rows at once.`);

  const writes = {};
  const before = {};
  for (const name of SYNCED.filter((n) => names.includes(n))) {
    writes[name] = [];
    before[name] = new Map();
    for (const b of body[name]) {
      if (!b || typeof b.id !== 'string' || !b.id) throw refuse('send each row with its id.');
      if (before[name].has(b.id)) throw refuse('send each row once.');
      const { existing, row } = await merged(store, name, b.id, b);
      const problem = check(name, row);
      if (problem) throw refuse(problem);
      before[name].set(b.id, existing);
      writes[name].push(row);
    }
  }

  for (const [name, refs, target, what] of REFERENCES) {
    for (const row of writes[name] ?? []) {
      if (row.deletedAt) continue;
      for (const ref of refs(row)) {
        if (ref == null || writes[target]?.some((r) => r.id === ref)) continue;
        if (!(await store.get(target, ref))) throw refuse(`${what} that isn’t saved yet.`);
      }
    }
  }

  if (writes.entries) {
    const sent = new Map((writes.foods ?? []).map((f) => [f.id, f]));
    const foods = new Map(sent);
    const touched = new Set();
    for (const e of writes.entries) {
      if (e.foodId && !foods.has(e.foodId)) {
        const food = await store.get('foods', e.foodId);
        if (food) foods.set(food.id, food);
      }
      if (remember(e, before.entries.get(e.id), foods, ctx.now) && !sent.has(e.foodId)) touched.add(foods.get(e.foodId));
    }
    if (touched.size) (writes.foods ??= []).push(...touched);
  }
  return store.write(writes, ctx.now);
}

/** DELETE /:table/:id: a soft delete, so Undo is a PUT with deletedAt: null. */
export async function deleteRow(ctx, name, id) {
  const row = await ctx.store.get(name, id);
  if (!row) throw refuse('that no longer exists.', 404);
  return ctx.store.write({ [name]: [{ ...row, deletedAt: row.deletedAt ?? ctx.now }] }, ctx.now);
}

/** Default settings, written once. Never overwrites an edit. */
export async function ensureSeeded(store, now) {
  if (await store.getMeta('seeded')) return;
  await store.write({
    settings: Object.entries(DEFAULT_SETTINGS).map(([id, value]) => ({ id, value, deletedAt: null })),
  }, now, { insertOnly: ['settings'] });
  await store.setMeta('seeded', 1);
}

/** The live settings as { key: value }, with the defaults for any not saved. */
export async function settingsOf(store) {
  const rows = await store.live('settings');
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.id, r.value])) };
}
