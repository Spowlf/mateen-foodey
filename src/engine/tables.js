// The synced tables' fields, as in worker/schema.sql (tests/worker/schema.test.js checks they match).
// Here, not in the Worker, because the backup check uses them on the phone too.
// required: fields a live row must have. json: columns stored as JSON text. clientWrites: false for
// tables only the Worker writes. Every row also has id, updatedAt, deletedAt and rev.

export const SYSTEM_FIELDS = ['id', 'updatedAt', 'deletedAt', 'rev'];

const table = (fields, { required = [], json = [], clientWrites = true, defaults = {} } = {}) => ({
  columns: [...SYSTEM_FIELDS, ...fields], fields, required, json, clientWrites, defaults,
});

export const TABLES = {
  foods: table([
    'name', 'brand', 'barcode', 'state', 'per100g', 'carbsIncludeFibre', 'servings', 'gramsPer100ml', 'source', 'sourceId',
    'fetchedAt', 'assumptions', 'usualGrams', 'useCount', 'lastUsedAt', 'userEdited',
  ], {
    required: ['name', 'state', 'per100g', 'source'],
    json: ['per100g', 'servings'],
    defaults: { carbsIncludeFibre: 0, servings: [], gramsPer100ml: 100, useCount: 0, userEdited: 0 },
  }),
  pots: table(['name', 'grams'], { required: ['name', 'grams'] }),
  recipes: table(['name', 'ingredients'], { required: ['name', 'ingredients'], json: ['ingredients'] }),
  batches: table(['recipeId', 'date', 'ingredients', 'totals', 'weighedGrams', 'potId', 'finishedGrams', 'portions'], {
    required: ['recipeId', 'date', 'ingredients', 'totals', 'finishedGrams'], json: ['ingredients', 'totals'],
  }),
  savedMeals: table(['name', 'items'], { required: ['name', 'items'], json: ['items'] }),
  entries: table([
    'date', 'meal', 'foodId', 'batchId', 'savedMealId', 'name', 'grams', 'nutrition', 'nutritionBasis', 'portionBasis', 'assumptions',
    'status', 'origin', 'createdAt',
  ], {
    required: ['date', 'meal', 'name', 'nutrition', 'nutritionBasis', 'status', 'origin'],
    json: ['nutrition'],
    defaults: { status: 'logged', origin: 'manual' },
  }),
  days: table(['state'], { required: ['state'] }),
  targets: table(['fromDate', 'mode', 'kcal', 'proteinG', 'carbsG', 'fatG', 'goalRateG'], { required: ['fromDate', 'mode', 'kcal'] }),
  weights: table(['date', 'grams', 'source'], { required: ['date', 'grams'], defaults: { source: 'manual' } }),
  // Only POST /health writes activity.
  activity: table(['date', 'activeKcal', 'steps', 'source'], { required: ['date'], clientWrites: false }),
  workouts: table(['date', 'start', 'type', 'minutes', 'kcal', 'source', 'activityId'], { required: ['date', 'type', 'minutes', 'kcal', 'source'] }),
  reviews: table(['weekStart', 'completedAt'], { required: ['weekStart', 'completedAt'] }),
  settings: table(['value'], { required: ['value'], json: ['value'] }),
};

/** Synced tables, in the order a restore writes them (each after the tables it refers to). */
export const SYNCED = Object.keys(TABLES);
