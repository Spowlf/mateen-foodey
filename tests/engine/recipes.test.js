import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchLine, batchTotals, finishedGrams, servedAmounts, portion, gramsLeft, hasLeft, batchEntry, makeAgain } from '../../src/engine/recipes.js';
import { AMOUNT_FIELDS } from '../../src/engine/nutrition.js';
import { OATS, MILK, HONEY } from './fixtures.js';

const lines = () => [batchLine(OATS, 80), batchLine(MILK, 400), batchLine(HONEY, 21)];

function makeBatch(extra = {}) {
  const ingredients = lines();
  return { id: 'b1', recipeId: 'r1', date: '2026-10-23', ingredients, totals: batchTotals(ingredients), finishedGrams: 501, portions: null, ...extra };
}

test('recipes: totals carry estimates and unknowns', () => {
  const t = batchTotals(lines());
  assert.equal(t.kcalMilli, 300_000 + 184_000 + 63_840);
  assert.equal(t.estimated, true);                 // honey is an estimate, so the batch is "~"
  assert.equal(t.fibreUg, 7_200_000);              // honey's fibre unknown: left out, not 0
  assert.deepEqual(t.partial, ['fibreUg', 'saltUg']);
  assert.deepEqual(t.unknown, { fibreUg: 1, saltUg: 1 });
  assert.equal(batchTotals([batchLine(OATS, 80)]).estimated, false);
});

test('recipes: finished weight defaults to the sum, a weighed dish less its pot', () => {
  assert.equal(finishedGrams({ lines: lines() }), 501);
  assert.equal(finishedGrams({ lines: lines(), weighedGrams: 812, potGrams: 300 }), 512);
  assert.equal(finishedGrams({ lines: lines(), weighedGrams: 480 }), 480);
  assert.equal(finishedGrams({ lines: lines(), weighedGrams: 250, potGrams: 300 }), null);
});

test('recipes: nutrition per gram from totals and finished weight', () => {
  const b = makeBatch();
  const served = servedAmounts(b, 100);
  assert.equal(served.kcalMilli, 109_349);         // 547,840 × 100 ÷ 501 = 109,349.3
  assert.equal(servedAmounts(b, 501).kcalMilli, b.totals.kcalMilli);
  assert.equal(served.fibreUg, Math.round((7_200_000 * 100) / 501));
  assert.deepEqual(served.partial, ['fibreUg', 'saltUg']);
});

test('recipes: portions split the totals, any remainder in the last', () => {
  const b = makeBatch({ finishedGrams: 500, portions: 3 });
  const parts = [1, 2, 3].map((n) => portion(b, n));
  assert.deepEqual(parts.map((p) => p.nutrition.kcalMilli), [182_613, 182_613, 182_614]);
  assert.deepEqual(parts.map((p) => p.grams), [166, 166, 168]);
  for (const f of AMOUNT_FIELDS) {
    if (b.totals[f] == null) continue;
    assert.equal(parts.reduce((s, p) => s + p.nutrition[f], 0), b.totals[f], f);
  }
  assert.throws(() => portion(b, 4), RangeError);
});

test('recipes: grams left never below zero, and an empty batch leaves the chips', () => {
  const b = makeBatch({ finishedGrams: 500 });
  const e = (id, grams, extra = {}) => ({ id, batchId: 'b1', grams, deletedAt: null, ...extra });
  assert.equal(gramsLeft(b, [e('1', 200)]), 300);
  assert.equal(gramsLeft(b, [e('1', 200), e('2', 100, { deletedAt: 9 }), e('3', 50, { batchId: 'other' })]), 300);
  assert.equal(gramsLeft(b, [e('1', 200), e('2', 350)]), 0);
  assert.equal(hasLeft(b, [e('1', 500)]), false);
  assert.equal(hasLeft(b, [e('1', 499)]), true);
});

test('recipes: a batch entry is an estimate when an ingredient was, with its assumptions', () => {
  const b = makeBatch();
  const entry = batchEntry({ id: 'e1', batch: b, name: 'Porridge', grams: 250, date: '2026-10-23', meal: 'breakfast', createdAt: 1 });
  assert.deepEqual([entry.nutritionBasis, entry.portionBasis, entry.assumptions, entry.batchId, entry.grams], ['estimate', 'typed', 'Assumed clear honey.', 'b1', 250]);
  const byPortion = batchEntry({ id: 'e2', batch: { ...b, finishedGrams: 500, portions: 2 }, name: 'Porridge', portionNumber: 2, date: '2026-10-23', meal: 'lunch', createdAt: 1 });
  assert.deepEqual([byPortion.portionBasis, byPortion.grams], ['serving', 250]);
});

test('copied at logging: changing a food or the recipe later never changes a batch or its entries', () => {
  const oats = structuredClone(OATS);
  const ingredients = [batchLine(oats, 80), batchLine(MILK, 400)];
  const b = { id: 'b2', ingredients, totals: batchTotals(ingredients), finishedGrams: 480 };
  const entry = batchEntry({ id: 'e3', batch: b, name: 'Porridge', grams: 240, date: '2026-10-23', meal: 'breakfast', createdAt: 1 });
  const before = structuredClone({ b, entry });
  oats.per100g.kcalTenths = 1;
  oats.name = 'Jumbo oats';
  assert.deepEqual({ b, entry }, before);
  assert.deepEqual(makeAgain(b), [{ foodId: 'f-oats', grams: 80 }, { foodId: 'f-milk', grams: 400 }]);
});
