import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodEntry, servingEntry, quickEntry, dayTotal, foodMemory, mlToGrams } from '../../src/engine/entries.js';
import { mealForTime } from '../../src/engine/meals.js';
import { today, partsFromIso } from '../../src/engine/dates.js';
import { kcalOf } from '../../src/engine/nutrition.js';
import { OATS, BREAD, HONEY, MILK } from './fixtures.js';

const base = { date: '2026-10-23', meal: 'breakfast', origin: 'manual', createdAt: 1 };

test('copied at logging: editing the food later never changes the entry', () => {
  const food = structuredClone(HONEY);
  const entry = foodEntry({ ...base, id: 'e1', food, grams: 20, portionBasis: 'weighed' });
  const before = structuredClone(entry);
  food.name = 'Manuka honey';
  food.per100g.kcalTenths = 9999;
  food.assumptions = 'Changed.';
  assert.deepEqual(entry, before);
  assert.equal(entry.name, 'Honey');
  assert.equal(entry.assumptions, 'Assumed clear honey.');
  assert.equal(entry.nutrition.kcalMilli, 60_800);
});

test('entries: a labelled serving', () => {
  const e = servingEntry({ ...base, id: 'e2', food: BREAD, serving: BREAD.servings[0], count: 2 });
  assert.deepEqual([e.grams, e.portionBasis, kcalOf(e.nutrition.kcalMilli)], [80, 'serving', 186]);
});

test('entries: grams from 1 to 5,000', () => {
  assert.throws(() => foodEntry({ ...base, id: 'x', food: OATS, grams: 0, portionBasis: 'typed' }), RangeError);
  assert.throws(() => foodEntry({ ...base, id: 'x', food: OATS, grams: 5001, portionBasis: 'typed' }), RangeError);
});

test('quick add: typed kcal; what isn’t typed is unknown', () => {
  const e = quickEntry({ ...base, id: 'q', kcal: 450, proteinG: 30 });
  assert.deepEqual([e.nutritionBasis, e.origin, e.name, e.nutrition.kcalMilli, e.nutrition.proteinUg, e.nutrition.fatUg], ['quick', 'quick', 'Quick add', 450_000, 30_000_000, null]);
});

test('day total: To check entries count, deleted ones don’t', () => {
  const entries = [
    foodEntry({ ...base, id: 'a', food: OATS, grams: 40, portionBasis: 'weighed' }),
    { ...foodEntry({ ...base, id: 'b', food: MILK, grams: 200, portionBasis: 'guessed' }), status: 'toCheck' },
    { ...foodEntry({ ...base, id: 'c', food: BREAD, grams: 40, portionBasis: 'weighed' }), deletedAt: 5 },
    foodEntry({ ...base, id: 'd', food: OATS, grams: 40, date: '2026-10-22', portionBasis: 'weighed' }),
  ];
  assert.equal(kcalOf(dayTotal(entries, '2026-10-23').kcalMilli), 150 + 92);
});

test('food memory: each log updates the usual grams', () => {
  assert.deepEqual(foodMemory({ useCount: 4 }, 55, 99), { usualGrams: 55, useCount: 5, lastUsedAt: 99 });
  assert.deepEqual(foodMemory({}, 40, 1), { usualGrams: 40, useCount: 1, lastUsedAt: 1 });
});

test('liquids: ml to grams with the food’s density, 1 by default', () => {
  assert.equal(mlToGrams(250), 250);
  assert.equal(mlToGrams(250, MILK.gramsPer100ml), 258);
});

test('meal slot from the time', () => {
  assert.equal(mealForTime('07:30'), 'breakfast');
  assert.equal(mealForTime('11:59'), 'breakfast');
  assert.equal(mealForTime('12:00'), 'lunch');
  assert.equal(mealForTime('17:59'), 'lunch');
  assert.equal(mealForTime('18:00'), 'dinner');
  // Snacks come any time of day, so the time never picks them.
  assert.equal(mealForTime('22:15'), 'dinner');
  assert.equal(mealForTime('03:59'), 'dinner');
  assert.equal(mealForTime('10:30', { lunch: '10:00' }), 'lunch');
  // A value saved before snacks lost their time still works.
  assert.equal(mealForTime('22:15', { breakfast: '04:00', lunch: '11:00', dinner: '17:00', snacks: '21:00' }), 'dinner');
});

test('dates from the phone: an entry logged at 23:30 stays on that date', () => {
  assert.equal(today(new Date(2026, 9, 22, 23, 30)), '2026-10-22');
  // 23:30 in New York is 04:30 the next day in UTC; the phone's own date wins.
  assert.equal(partsFromIso('2026-10-22T23:30:00-05:00').date, '2026-10-22');
  assert.equal(partsFromIso('2026-10-23T00:30:00+09:00').date, '2026-10-23');
  assert.equal(partsFromIso('not a time'), null);
});
