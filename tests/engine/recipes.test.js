import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchLine, batchTotals, finishedGrams, servedAmounts, portion, gramsLeft, hasLeft, batchEntry, makeAgain, servingSplits } from '../../src/engine/recipes.js';
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

test('recipes: portions logged together keep the remainder in the last, and count against what’s left', async () => {
  const { portions, portionsLogged, portionsLeft } = await import('../../src/engine/recipes.js');
  const b = makeBatch({ finishedGrams: 500, portions: 3 });
  const two = portions(b, 2, 2);
  assert.deepEqual([two.grams, two.nutrition.kcalMilli], [166 + 168, 182_613 + 182_614]);
  const entry = batchEntry({ id: 'e9', batch: b, name: 'Porridge', portionNumber: 1, portionCount: 2, date: '2026-10-23', meal: 'lunch', createdAt: 1 });
  assert.deepEqual([entry.grams, entry.portionBasis], [332, 'serving']);
  const logged = [{ ...entry, deletedAt: null }, { id: 'x', batchId: 'b1', grams: 100, portionBasis: 'typed', deletedAt: null }];
  assert.equal(portionsLogged(b, logged), 2);                  // grams served don't count as portions
  assert.equal(portionsLeft(b, logged), 1);
  assert.equal(portionsLeft({ ...b, portions: null }, logged), 0);
  assert.throws(() => portions(b, 3, 2), RangeError);
});

test('recipes: making a batch sums or weighs the dish, subtracts the pot only when weighed, and says what’s missing', async () => {
  const { makeBatch: make, batchesOf, nextIngredients, leftText } = await import('../../src/engine/recipes.js');
  const lines = [{ food: OATS, grams: 80 }, { food: MILK, grams: 400 }, { food: HONEY, grams: 21 }];
  const pot = { id: 'p1', grams: 300 };
  const summed = make({ id: 'b9', recipeId: 'r1', date: '2026-10-23', lines, pot }).batch;
  assert.deepEqual([summed.finishedGrams, summed.potId, summed.weighedGrams, summed.totals.estimated], [501, null, null, true]);
  assert.deepEqual(summed.ingredients.map((l) => [l.foodId, l.state, l.grams]), [['f-oats', 'raw', 80], ['f-milk', 'asSold', 400], ['f-honey', 'asSold', 21]]);
  const weighed = make({ id: 'b9', recipeId: 'r1', date: '2026-10-23', lines, weighedGrams: 812, pot, portions: 2 }).batch;
  assert.deepEqual([weighed.finishedGrams, weighed.potId, weighed.portions], [512, 'p1', 2]);
  assert.deepEqual(make({ id: 'b', recipeId: 'r', date: '2026-10-23', lines, weighedGrams: 250, pot }), { error: 'The dish weighs less than the pot. Weigh it again.' });
  assert.deepEqual(make({ id: 'b', recipeId: 'r', date: '2026-10-23', lines: [] }), { error: 'Add an ingredient.' });
  assert.deepEqual(make({ id: 'b', recipeId: 'r', date: '2026-10-23', lines: [{ food: OATS, grams: null }] }), { error: 'Enter the grams of each ingredient.' });
  assert.deepEqual(make({ id: 'b', recipeId: 'r', date: '2026-10-23', lines, portions: 0 }), { error: 'Enter 1 to 100 portions, or leave it blank.' });

  const recipe = { id: 'r1', ingredients: [{ foodId: 'f-oats', grams: 50 }] };
  assert.deepEqual(nextIngredients(recipe, []), [{ foodId: 'f-oats', grams: 50 }]);
  const older = { ...summed, id: 'old', date: '2026-10-01', deletedAt: null };
  const newer = { ...weighed, id: 'new', deletedAt: null };
  assert.deepEqual(batchesOf([older, newer, { ...newer, id: 'gone', deletedAt: 1 }], 'r1').map((b) => b.id), ['new', 'old']);
  assert.deepEqual(nextIngredients(recipe, [older, newer]), [{ foodId: 'f-oats', grams: 80 }, { foodId: 'f-milk', grams: 400 }, { foodId: 'f-honey', grams: 21 }]);
  assert.equal(leftText({ ...newer, finishedGrams: 1500 }, [{ id: 'e', batchId: 'new', grams: 450, deletedAt: null }]), '~1,050 g left');
});

test('recipes: servings split the weight and totals equally, unknowns kept', () => {
  const b = makeBatch();
  const [three, four, five] = servingSplits(b.totals, b.finishedGrams);
  assert.deepEqual([three.count, three.grams, four.grams, five.grams], [3, 167, 125, 100]);
  assert.equal(three.nutrition.kcalMilli, Math.round(b.totals.kcalMilli / 3));
  assert.equal(five.nutrition.proteinUg, Math.round(b.totals.proteinUg / 5));
  assert.deepEqual(three.nutrition.partial, ['fibreUg', 'saltUg']);
  assert.equal(servingSplits({ ...b.totals, fatUg: null }, 501, [2])[0].nutrition.fatUg, null);
});
