// The 2026-10-24 migration on a database made before it: every food and cached food kept, and
// SG FoodID allowed as a source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../../scripts/sqlite-d1.js';

const SCHEMA = readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../../worker/migrations/2026-10-24-sgfoodid.sql', import.meta.url), 'utf8');
const BEFORE = SCHEMA.replaceAll("'sgfoodid', ", '');

const shape = (db, table) => ({
  columns: db.raw.prepare(`PRAGMA table_info("${table}")`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]),
  indexes: db.raw.prepare(`PRAGMA index_list("${table}")`).all().filter((i) => i.origin === 'c').map((i) => [i.name, i.unique, i.partial]).sort(),
});
const food = (db, id, source, sourceId, deletedAt = null) => db.raw.prepare(`INSERT INTO foods (id, name, state, per100g, source, sourceId, useCount, updatedAt, deletedAt, rev)
  VALUES (?, 'Oats', 'raw', '{"kcalTenths":3750}', ?, ?, 3, 5, ?, 2)`).run(id, source, sourceId, deletedAt);
const cached = (db, id, source) => db.raw.prepare(`INSERT INTO sourceFoods (id, source, sourceId, name, nameNorm, state, per100g, fetchedAt)
  VALUES (?, ?, ?, 'Kopi', 'kopi', 'asSold', '{}', 1)`).run(`${source}:${id}`, source, id);

test('migration: foods and cached foods are kept, and SG FoodID becomes a source', async () => {
  assert.notEqual(BEFORE, SCHEMA);
  const db = sqliteD1(':memory:', BEFORE);
  food(db, 'a', 'cofid', '11-001', 9);
  food(db, 'b', 'cofid', '11-001');
  food(db, 'c', 'custom', null);
  cached(db, '11-001', 'cofid');
  assert.throws(() => food(db, 'x', 'sgfoodid', 'F1'), /CHECK/);
  const rows = db.raw.prepare('SELECT * FROM foods ORDER BY id').all();

  await db.exec(MIGRATION);
  assert.deepEqual(db.raw.prepare('SELECT * FROM foods ORDER BY id').all(), rows);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM sourceFoods').get().n, 1);
  food(db, 'd', 'sgfoodid', 'F05100133');
  cached(db, 'F05100133', 'sgfoodid');
  assert.throws(() => food(db, 'e', 'sgfoodid', 'F05100133'), /UNIQUE/);   // still one live food per source food
  assert.throws(() => food(db, 'f', 'elsewhere', '1'), /CHECK/);

  // The same tables as a database made from today's schema.
  const fresh = sqliteD1(':memory:', SCHEMA);
  for (const table of ['foods', 'sourceFoods']) assert.deepEqual(shape(db, table), shape(fresh, table), table);
});
