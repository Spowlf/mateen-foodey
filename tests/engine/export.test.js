import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupData, readBackup, entriesCsv } from '../../src/engine/export.js';
import { foodEntry } from '../../src/engine/entries.js';
import { batchLine, batchTotals } from '../../src/engine/recipes.js';
import { OATS, HONEY } from './fixtures.js';

// Restore's checks before anything is written. Writing it all in one D1 transaction, and a failure
// partway through, are tested against the Worker in Stage 2.

function state() {
  const ingredients = [batchLine(OATS, 80), batchLine(HONEY, 20)];
  return {
    foods: [{ ...OATS }, { ...HONEY, deletedAt: 7 }],   // a deleted food still in the backup
    pots: [{ id: 'p1', name: 'Big pan', grams: 900 }],
    recipes: [{ id: 'r1', name: 'Porridge', ingredients: [{ foodId: OATS.id, grams: 80 }] }],
    batches: [{ id: 'b1', recipeId: 'r1', date: '2026-10-20', ingredients, totals: batchTotals(ingredients), weighedGrams: null, potId: 'p1', finishedGrams: 100, portions: null }],
    savedMeals: [{ id: 'm1', name: 'Breakfast', items: [{ foodId: OATS.id, grams: 40 }] }],
    entries: [
      foodEntry({ id: 'e1', food: OATS, grams: 40, date: '2026-10-20', meal: 'breakfast', portionBasis: 'weighed', createdAt: 2 }),
      foodEntry({ id: 'e2', food: HONEY, grams: 10, date: '2026-10-20', meal: 'breakfast', portionBasis: 'weighed', createdAt: 1 }),
    ],
    days: [{ id: '2026-10-20', state: 'complete' }],
    settings: [{ id: 'floorKcal', value: 1500 }],
  };
}

const backup = () => backupData(state(), { now: 1_000 });
const changed = (fn) => { const b = backup(); fn(b.tables); return b; };

test('restore check: a good backup passes, deleted rows and their references included', () => {
  const r = readBackup(JSON.stringify(backup()));
  assert.equal(r.ok, true);
  assert.equal(r.counts.foods, 2);
  assert.equal(r.counts.entries, 2);
  assert.equal(r.total, 10);
  assert.equal(r.exportedAt, 1_000);
});

test('restore check: malformed JSON or another file changes nothing', () => {
  assert.deepEqual(readBackup('{ "app": "mateen-foodey", '), { ok: false, message: 'Nothing changed: this file isn’t a backup.' });
  assert.deepEqual(readBackup({ app: 'mateen-money', tables: {} }), { ok: false, message: 'Nothing changed: this isn’t a Mateen Foodey backup.' });
  assert.equal(readBackup({ ...backup(), version: 2 }).ok, false);
  assert.equal(readBackup(changed((t) => { t.entries = {}; })).ok, false);
  assert.equal(readBackup(changed((t) => { t.entries.push({ name: 'no id' }); })).ok, false);
});

test('restore check: missing fields', () => {
  const r = readBackup(changed((t) => { delete t.entries[0].nutrition; }));
  assert.deepEqual(r, { ok: false, message: 'Nothing changed: this backup is missing some details.' });
  assert.equal(readBackup(changed((t) => { t.foods[0].name = '  '; })).ok, false);
});

test('restore check: duplicate ids', () => {
  const r = readBackup(changed((t) => { t.entries.push({ ...t.entries[0] }); }));
  assert.deepEqual(r, { ok: false, message: 'Nothing changed: this backup has the same record twice.' });
});

test('restore check: broken references between foods, recipes, batches, pots and entries', () => {
  const cases = [
    [(t) => { t.entries[0].foodId = 'gone'; }, 'an entry names a food'],
    [(t) => { t.entries[0].batchId = 'gone'; }, 'an entry names a batch'],
    [(t) => { t.entries[0].savedMealId = 'gone'; }, 'an entry names a saved meal'],
    [(t) => { t.batches[0].recipeId = 'gone'; }, 'a batch names a recipe'],
    [(t) => { t.batches[0].potId = 'gone'; }, 'a batch names a pot'],
    [(t) => { t.batches[0].ingredients[0].foodId = 'gone'; }, 'a batch names a food'],
    [(t) => { t.recipes[0].ingredients[0].foodId = 'gone'; }, 'a recipe names a food'],
    [(t) => { t.savedMeals[0].items[0].foodId = 'gone'; }, 'a saved meal names a food'],
    [(t) => { t.savedMeals[0].items.push({ recipeId: 'gone', grams: 100 }); }, 'a saved meal names a recipe'],
  ];
  for (const [fn, what] of cases) {
    assert.deepEqual(readBackup(changed(fn)), { ok: false, message: `Nothing changed: ${what} that isn’t in the backup.` }, what);
  }
});

test('CSV: entries oldest first; unknown nutrients are blank, never 0', () => {
  const csv = entriesCsv(state().entries).split('\n');
  assert.equal(csv[0], 'Date,Meal,Food,Grams,kcal,Protein g,Carbs g,Fat g,Fibre g,Sugars g,Salt g,Nutrition,Portion,Status');
  assert.equal(csv[1], '20 Oct 2026,breakfast,Honey,10,30,0.0,8.2,0.0,,8.2,0.0,estimate,weighed,logged');
  assert.equal(csv[2], '20 Oct 2026,breakfast,Porridge oats,40,150,4.5,24.2,3.2,3.6,0.0,,database,weighed,logged');
});
