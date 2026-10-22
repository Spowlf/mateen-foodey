import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountsFor, sumAmounts, kcalOf, gramsOf, formatKcal, formatGrams, unknownLines, roundDiv } from '../../src/engine/nutrition.js';
import { OATS, HONEY, BREAD } from './fixtures.js';

test('scaling: per-100 g × grams in integer units, exactly', () => {
  const a = amountsFor(OATS.per100g, 40);
  assert.equal(a.kcalMilli, 150_000);       // 375 kcal per 100 g × 40 g = 150 kcal
  assert.equal(a.proteinUg, 4_480_000);     // 11.2 g × 0.4 = 4.48 g
  assert.equal(a.fibreUg, 3_600_000);
  for (const v of Object.values(a)) if (typeof v === 'number') assert.ok(Number.isInteger(v));
  assert.equal(kcalOf(a.kcalMilli), 150);
  assert.equal(gramsOf(a.proteinUg), 4);
});

test('scaling: rounding happens once, for display', () => {
  // 1.3 kcal per 100 g; 30 g is 0.39 kcal. Three of them are 1.17 kcal: 1, not 0 + 0 + 0.
  const tiny = { kcalTenths: 13, proteinMg: 0, carbsMg: 0, fatMg: 0, fibreMg: 0, sugarsMg: 0, saltMg: 0 };
  const one = amountsFor(tiny, 30);
  assert.equal(one.kcalMilli, 390);
  assert.equal(kcalOf(one.kcalMilli), 0);
  const total = sumAmounts([one, one, one]);
  assert.equal(total.kcalMilli, 1170);
  assert.equal(kcalOf(total.kcalMilli), 1);
});

test('scaling: grams must be whole', () => {
  assert.throws(() => amountsFor(OATS.per100g, 12.5), RangeError);
  assert.throws(() => amountsFor(OATS.per100g, -1), RangeError);
});

test('unknown is not zero: scaling keeps it unknown', () => {
  const a = amountsFor(HONEY.per100g, 20);
  assert.equal(a.fibreUg, null);
  assert.equal(amountsFor(OATS.per100g, 0).saltUg, null);
});

test('unknown is not zero: totals sum what is known and count what is not', () => {
  const total = sumAmounts([amountsFor(OATS.per100g, 40), amountsFor(HONEY.per100g, 20), amountsFor(BREAD.per100g, 40)]);
  assert.equal(total.fibreUg, 3_600_000 + 1_120_000);   // honey's fibre left out, not counted as 0
  assert.deepEqual(total.partial, ['fibreUg', 'saltUg']);
  assert.deepEqual(total.unknown, { fibreUg: 1, saltUg: 1 });
  assert.deepEqual(unknownLines(total), ['Fibre unknown for 1 food.', 'Salt unknown for 1 food.']);
});

test('unknown is not zero: unknown for every food stays unknown', () => {
  const total = sumAmounts([amountsFor(HONEY.per100g, 20), amountsFor(HONEY.per100g, 10)]);
  assert.equal(total.fibreUg, null);
  assert.deepEqual(unknownLines(total), ['Fibre unknown for 2 foods.']);
});

test('unknown is not zero: a partial amount counts as unknown in a bigger total', () => {
  const batchShare = { ...amountsFor(OATS.per100g, 40), partial: ['saltUg'], saltUg: 500 };
  const total = sumAmounts([batchShare, amountsFor(BREAD.per100g, 40)]);
  assert.equal(total.saltUg, 500 + 352_000);
  assert.deepEqual(total.unknown, { saltUg: 1 });
});

test('totals: nothing eaten is zero, not unknown', () => {
  const total = sumAmounts([]);
  assert.equal(total.kcalMilli, 0);
  assert.deepEqual(unknownLines(total), []);
});

test('totals: carbs that may include fibre are said', () => {
  const total = sumAmounts([amountsFor(BREAD.per100g, 40, { carbsIncludeFibre: true })]);
  assert.deepEqual(unknownLines(total), ['Carbs may include fibre.']);
});

test('display: whole kcal with separators, whole grams', () => {
  assert.equal(formatKcal(1240), '1,240 kcal');
  assert.equal(formatGrams(58, 'protein'), '58 g protein');
  assert.equal(formatGrams(150), '150 g');
  assert.equal(roundDiv(-1500, 1000), -2);
  assert.ok(Object.is(roundDiv(-400, 1000), 0));
});
