// The data model. D1 (worker/schema.sql) is the source of truth; IndexedDB holds the last-synced
// copy with the same field names, plus device-only rows in `meta`. The tables' fields are in
// src/engine/tables.js, so the Worker and the backup check share them.
//
// Every synced record has:
//   id         string   client UUID unless a table says otherwise
//   updatedAt  number   ms timestamp of the last change
//   deletedAt  number?  ms timestamp; set means deleted (so Undo just clears it)
//   rev        number   server-wide change counter, for GET /sync?since=rev
// Food amounts are integer grams. Dates are 'YYYY-MM-DD', decided by the phone.

import { SYNCED } from '../engine/tables.js';

export { SYNCED };

export const DB_NAME = 'mateen-foodey';
export const DB_VERSION = 1;

// store name -> { keyPath, indexes: { name: keyPath } }
export const STORES = {
  ...Object.fromEntries(SYNCED.map((name) => [name, { keyPath: 'id', indexes: name === 'entries' ? { byDate: 'date' } : {} }])),
  meta: { keyPath: 'key', indexes: {} },   // device only: { key, value } (connection, rev, lastSyncedAt, draft)
};

/**
 * @typedef {Object} Per100g  Nutrition per 100 g, as the source gave it. null = the source doesn't give it.
 * @property {number|null} kcalTenths  energy in tenths of a kcal
 * @property {number|null} proteinMg
 * @property {number|null} carbsMg     UK / EU labels: fibre excluded
 * @property {number|null} fatMg
 * @property {number|null} fibreMg
 * @property {number|null} sugarsMg
 * @property {number|null} saltMg
 */

/**
 * @typedef {Object} Amounts  Nutrition of an amount (see src/engine/nutrition.js). null = unknown.
 * @property {number|null} kcalMilli   thousandths of a kcal
 * @property {number|null} proteinUg   micrograms, likewise carbsUg, fatUg, fibreUg, sugarsUg, saltUg
 * @property {string[]} partial         fields that are a sum leaving out an unknown (a batch with one ingredient's fibre unknown)
 * @property {boolean} carbsIncludeFibre "Carbs may include fibre."
 */

/**
 * @typedef {Object} Food  One of your foods: logged, made or edited. A source food becomes one the first time it's logged.
 * @property {string} id
 * @property {string} name
 * @property {string|null} brand
 * @property {string|null} barcode
 * @property {'raw'|'cooked'|'asSold'} state   the state it's weighed in
 * @property {Per100g} per100g
 * @property {0|1} carbsIncludeFibre
 * @property {{ label: string, grams: number }[]} servings   ("1 slice", 36)
 * @property {number} gramsPer100ml   for liquids typed in ml; 100 for water
 * @property {'off'|'cofid'|'usda'|'custom'|'estimate'} source
 * @property {string|null} sourceId   one live food per source:sourceId
 * @property {number|null} fetchedAt  ms, when the source was read
 * @property {string|null} assumptions  for estimates: what the estimate rests on
 * @property {number|null} usualGrams
 * @property {number} useCount
 * @property {number|null} lastUsedAt  ms
 * @property {0|1} userEdited   1 = a refresh from the source never overwrites it
 */

/**
 * @typedef {Object} Entry  Something eaten. Name, nutrition and assumptions are copied at logging and never recalculated.
 * @property {string} id
 * @property {string} date   'YYYY-MM-DD', the phone's local date at logging
 * @property {'breakfast'|'lunch'|'dinner'|'snacks'} meal
 * @property {string|null} foodId
 * @property {string|null} batchId
 * @property {string|null} savedMealId   the saved meal it was logged from, so quick log can order saved meals by use
 * @property {string} name
 * @property {number|null} grams   null for quick add
 * @property {Amounts} nutrition
 * @property {'database'|'estimate'|'quick'} nutritionBasis
 * @property {'weighed'|'typed'|'serving'|'guessed'|null} portionBasis   null for quick add
 * @property {string|null} assumptions
 * @property {'logged'|'toCheck'} status
 * @property {'manual'|'sentence'|'photo'|'shortcut'|'quick'} origin
 * @property {number} createdAt   ms
 */

/**
 * Saved meals, recipes, batches and pots (see src/engine/recipes.js):
 *   savedMeals  { id, name, items: [{ foodId, grams }] }
 *   recipes     { id, name, ingredients: [{ foodId, grams }] }
 *   batches     { id, recipeId, date, ingredients: [{ foodId, name, state, grams, nutrition, estimated, assumptions }],
 *                 totals (Amounts plus unknown counts and estimated), weighedGrams, potId, finishedGrams, portions }
 *               finishedGrams = the ingredients' sum, or weighedGrams less the pot
 *   pots        { id, name, grams }
 */

/**
 * Days, targets and the review:
 *   days      { id: date, state: 'complete' | 'incomplete' }   no row = unreviewed
 *   targets   { id: fromDate, fromDate, mode: 'fixed' | 'adaptive', kcal, proteinG, carbsG, fatG, goalRateG }
 *             a day's target is the latest row on or before it; goalRateG is g a week (−750, −500, −250, 0, 250)
 *   reviews   { id: weekStart, weekStart, completedAt }   weekStart = the Monday starting the reviewed week
 */

/**
 * Body and exercise:
 *   weights   { id: date, date, grams, source: 'manual' | 'health' | 'import' }   one a day; the latest wins
 *   activity  { id: date, date, activeKcal, steps, source }   POST /health replaces it
 *   workouts  { id, date, start, type, minutes, kcal, source: 'health' | 'manual', activityId }
 *             Health ones have id `health:<start>:<type>`; manual ones name a MET activity
 */

/**
 * Settings rows ({ id, value }):
 *   floorKcal           1500
 *   exerciseAddBackPct  50 (fixed mode)
 *   mealTimes           { breakfast, lunch, dinner, snacks } as 'HH:MM' (see src/engine/meals.js)
 *   weightUnit          'kg' | 'stlb'
 *   sources             { off, cofid, usda } each true or false
 */
