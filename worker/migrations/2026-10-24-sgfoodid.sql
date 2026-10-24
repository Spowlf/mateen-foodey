-- 2026-10-24: SG FoodID becomes a food source. SQLite can't change a CHECK constraint, so foods and
-- sourceFoods are made again with 'sgfoodid' allowed, keeping every row, then their indexes.
-- Only for a database made before this date (worker/schema.sql already has it). Once, after a backup:
--   npx wrangler d1 export mateen-foodey --remote --output=<backup>.sql
--   npx wrangler d1 execute mateen-foodey --remote --file worker/migrations/2026-10-24-sgfoodid.sql

CREATE TABLE foods_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  state TEXT NOT NULL CHECK (state IN ('raw', 'cooked', 'asSold')),
  per100g TEXT NOT NULL,
  carbsIncludeFibre INTEGER NOT NULL DEFAULT 0,
  servings TEXT NOT NULL DEFAULT '[]',
  gramsPer100ml INTEGER NOT NULL DEFAULT 100,
  source TEXT NOT NULL CHECK (source IN ('off', 'cofid', 'sgfoodid', 'usda', 'custom', 'estimate')),
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
INSERT INTO foods_new (id, name, brand, barcode, state, per100g, carbsIncludeFibre, servings, gramsPer100ml, source, sourceId, fetchedAt, assumptions, usualGrams, useCount, lastUsedAt, userEdited, updatedAt, deletedAt, rev)
  SELECT id, name, brand, barcode, state, per100g, carbsIncludeFibre, servings, gramsPer100ml, source, sourceId, fetchedAt, assumptions, usualGrams, useCount, lastUsedAt, userEdited, updatedAt, deletedAt, rev FROM foods;
DROP TABLE foods;
ALTER TABLE foods_new RENAME TO foods;
CREATE INDEX IF NOT EXISTS foods_rev ON foods (rev);
CREATE UNIQUE INDEX IF NOT EXISTS foods_source ON foods (source, sourceId) WHERE deletedAt IS NULL AND sourceId IS NOT NULL;

CREATE TABLE sourceFoods_new (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('off', 'cofid', 'sgfoodid', 'usda')),
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
INSERT INTO sourceFoods_new (id, source, sourceId, name, nameNorm, brand, barcode, state, per100g, carbsIncludeFibre, servings, fetchedAt)
  SELECT id, source, sourceId, name, nameNorm, brand, barcode, state, per100g, carbsIncludeFibre, servings, fetchedAt FROM sourceFoods;
DROP TABLE sourceFoods;
ALTER TABLE sourceFoods_new RENAME TO sourceFoods;
CREATE INDEX IF NOT EXISTS sourceFoods_source ON sourceFoods (source);
