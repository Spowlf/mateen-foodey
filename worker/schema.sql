-- Mateen Foodey: the D1 database. The single source of truth.
-- Field names match src/engine/tables.js exactly (camelCase), so rows need no mapping (a test checks).
-- Every synced row has updatedAt (ms), deletedAt (ms, null = live) and rev (the change counter
-- the phone pulls from: GET /sync?since=rev). Food amounts are integer grams; nutrition is integers
-- (see src/engine/nutrition.js); dates are 'YYYY-MM-DD', decided by the phone.
-- Apply with: npx wrangler d1 execute mateen-foodey --remote --file worker/schema.sql

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', 0);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  state TEXT NOT NULL CHECK (state IN ('raw', 'cooked', 'asSold')),
  per100g TEXT NOT NULL,
  carbsIncludeFibre INTEGER NOT NULL DEFAULT 0,
  servings TEXT NOT NULL DEFAULT '[]',
  gramsPer100ml INTEGER NOT NULL DEFAULT 100,
  source TEXT NOT NULL CHECK (source IN ('off', 'cofid', 'usda', 'custom', 'estimate')),
  sourceId TEXT,
  fetchedAt INTEGER,
  assumptions TEXT,
  usualGrams INTEGER,
  useCount INTEGER NOT NULL DEFAULT 0,
  lastUsedAt INTEGER,
  userEdited INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS foods_rev ON foods (rev);
-- One live food per source food, so logging it twice never makes two.
CREATE UNIQUE INDEX IF NOT EXISTS foods_source ON foods (source, sourceId) WHERE deletedAt IS NULL AND sourceId IS NOT NULL;

CREATE TABLE IF NOT EXISTS pots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grams INTEGER NOT NULL CHECK (grams >= 0),
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pots_rev ON pots (rev);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recipes_rev ON recipes (rev);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  recipeId TEXT NOT NULL,
  date TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  totals TEXT NOT NULL,
  weighedGrams INTEGER,
  potId TEXT,
  finishedGrams INTEGER NOT NULL CHECK (finishedGrams > 0),
  portions INTEGER CHECK (portions IS NULL OR portions > 0),
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_rev ON batches (rev);

CREATE TABLE IF NOT EXISTS savedMeals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS savedMeals_rev ON savedMeals (rev);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  foodId TEXT,
  batchId TEXT,
  name TEXT NOT NULL,
  grams INTEGER CHECK (grams IS NULL OR (grams > 0 AND grams <= 5000)),
  nutrition TEXT NOT NULL,
  nutritionBasis TEXT NOT NULL CHECK (nutritionBasis IN ('database', 'estimate', 'quick')),
  portionBasis TEXT CHECK (portionBasis IS NULL OR portionBasis IN ('weighed', 'typed', 'serving', 'guessed')),
  assumptions TEXT,
  status TEXT NOT NULL DEFAULT 'logged' CHECK (status IN ('logged', 'toCheck')),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'sentence', 'photo', 'shortcut', 'quick')),
  createdAt INTEGER,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_rev ON entries (rev);
CREATE INDEX IF NOT EXISTS entries_date ON entries (date);

-- id = the date. No row means unreviewed.
CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('complete', 'incomplete')),
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS days_rev ON days (rev);

-- id = fromDate. A day's target is the latest row on or before it.
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  fromDate TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fixed', 'adaptive')),
  kcal INTEGER NOT NULL CHECK (kcal > 0),
  proteinG INTEGER,
  carbsG INTEGER,
  fatG INTEGER,
  goalRateG INTEGER,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS targets_rev ON targets (rev);

-- id = the date: one a day, the latest saved wins.
CREATE TABLE IF NOT EXISTS weights (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  grams INTEGER NOT NULL CHECK (grams > 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'health', 'import')),
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS weights_rev ON weights (rev);

-- id = the date; POST /health replaces it.
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  activeKcal INTEGER,
  steps INTEGER,
  source TEXT,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_rev ON activity (rev);

-- Health workouts have id 'health:<start>:<type>', so a rerun adds nothing.
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start TEXT,
  type TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  kcal INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('health', 'manual')),
  activityId TEXT,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workouts_rev ON workouts (rev);

-- id = the Monday that starts the reviewed week.
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  weekStart TEXT NOT NULL,
  completedAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_rev ON reviews (rev);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS settings_rev ON settings (rev);

-- Worker only (not synced) ------------------------------------------------------------------

-- The source cache: CoFID's import, plus every Open Food Facts and USDA food looked up.
-- id = '<source>:<sourceId>'. Search uses nameNorm (src/engine/match.js).
CREATE TABLE IF NOT EXISTS sourceFoods (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('off', 'cofid', 'usda')),
  sourceId TEXT NOT NULL,
  name TEXT NOT NULL,
  nameNorm TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  state TEXT NOT NULL,
  per100g TEXT NOT NULL,
  carbsIncludeFibre INTEGER NOT NULL DEFAULT 0,
  servings TEXT NOT NULL DEFAULT '[]',
  fetchedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sourceFoods_source ON sourceFoods (source);

-- Recent searches. id = '<source>:<queryNorm>'. Asked again within 7 days, the answer comes from
-- here and sourceFoods, without asking Open Food Facts or USDA.
CREATE TABLE IF NOT EXISTS searchCache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  queryNorm TEXT NOT NULL,
  sourceFoodIds TEXT NOT NULL,
  fetchedAt INTEGER NOT NULL
);

-- The cost guard: model calls per day. id = the Worker's own UTC date.
CREATE TABLE IF NOT EXISTS parseCalls (
  id TEXT PRIMARY KEY,
  calls INTEGER NOT NULL
);
