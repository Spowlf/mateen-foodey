import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  per100gFromText, per100gText, servingsFromText, customFood, editedFood, myFoods, adoptFoods, storedLines, linesWithFoods, linesTotal,
} from '../../src/engine/foods.js';
import { OATS, MILK, HONEY, BREAD } from './fixtures.js';

const label = (extra = {}) => ({ kcal: '233.5', protein: '8.4', carbs: '43,4', fat: '1.6', fibre: '', sugars: '3.4', salt: '0.88', ...extra });

test('typed nutrition: converted to integers once, blank left unknown, never 0', () => {
  const { per100g } = per100gFromText(label());
  assert.deepEqual(per100g, { kcalTenths: 2335, proteinMg: 8400, carbsMg: 43400, fatMg: 1600, fibreMg: null, sugarsMg: 3400, saltMg: 880 });
  assert.equal(per100gFromText(label({ salt: '0.025' })).per100g.saltMg, 25);
  assert.equal(per100gFromText(label({ fat: '0' })).per100g.fatMg, 0);
});

test('typed nutrition: says what to do when a figure can’t be used', () => {
  assert.deepEqual(per100gFromText(label({ kcal: '' })), { error: 'Enter the kcal per 100 g.' });
  assert.deepEqual(per100gFromText(label({ kcal: '901' })), { error: 'Enter kcal per 100 g from 0 to 900.' });
  assert.deepEqual(per100gFromText(label({ kcal: '23.55' })), { error: 'Enter kcal per 100 g from 0 to 900.' });
  assert.deepEqual(per100gFromText(label({ protein: 'lots' })), { error: 'Enter protein in grams per 100 g, from 0 to 100.' });
  assert.deepEqual(per100gFromText(label({ salt: '100.5' })), { error: 'Enter salt in grams per 100 g, from 0 to 100.' });
});

test('typed nutrition: shown again for editing exactly as stored', () => {
  assert.deepEqual(per100gText(HONEY.per100g), { kcal: '304', protein: '0.3', carbs: '82.4', fat: '0', fibre: '', sugars: '82.1', salt: '0.01' });
  assert.deepEqual(per100gFromText(per100gText(HONEY.per100g)).per100g, HONEY.per100g);
});

test('servings: blank rows dropped, each needs a name and whole grams', () => {
  assert.deepEqual(servingsFromText([{ label: ' 1 slice ', grams: '36' }, { label: '', grams: '' }]), { servings: [{ label: '1 slice', grams: 36 }] });
  assert.deepEqual(servingsFromText([{ label: '', grams: '36' }]), { error: 'Give each serving a name, like “1 slice”.' });
  assert.deepEqual(servingsFromText([{ label: '1 pot', grams: '0' }]), { error: 'Enter the grams in 1 pot, from 1 to 5,000.' });
});

test('a food you add is yours and marked edited, so no source overwrites it', () => {
  const food = customFood({ id: 'c1', name: ' Granola ', brand: ' ', per100g: OATS.per100g });
  assert.deepEqual([food.name, food.brand, food.source, food.userEdited, food.state, food.gramsPer100ml], ['Granola', null, 'custom', 1, 'asSold', 100]);
});

test('editing a food marks it edited; changing an estimate’s nutrition makes it your own', () => {
  const fields = { name: 'Bread', state: 'asSold', per100g: BREAD.per100g, servings: [], gramsPer100ml: 100 };
  assert.equal(editedFood(BREAD, fields).userEdited, 1);
  assert.equal(editedFood(BREAD, fields).source, undefined);
  const sameHoney = editedFood(HONEY, { ...fields, per100g: { ...HONEY.per100g } });
  assert.equal(sameHoney.source, undefined);                   // renamed only: still an estimate
  const labelled = editedFood(HONEY, { ...fields, per100g: { ...HONEY.per100g, fibreMg: 200 } });
  assert.deepEqual([labelled.source, labelled.assumptions], ['custom', null]);
});

test('my foods: most used first, then by name; a search ranks by match; deleted ones left out', () => {
  const foods = [{ ...OATS, useCount: 2 }, { ...MILK, useCount: 5 }, { ...BREAD, useCount: 2 }, { ...HONEY, useCount: 9, deletedAt: 1 }];
  assert.deepEqual(myFoods(foods).map((f) => f.id), ['f-milk', 'f-oats', 'f-bread']);
  assert.deepEqual(myFoods(foods, 'bread').map((f) => f.id), ['f-bread']);
});

test('adopting foods: yours kept, a source food you have reused, the rest added once', () => {
  let n = 0;
  const newId = () => `id${++n}`;
  const mine = { ...MILK, id: 'f-mine-milk' };
  const { foods, lines } = adoptFoods({
    lines: [{ food: OATS, grams: 80 }, { food: { ...MILK, id: undefined }, grams: 400 }, { food: { ...BREAD, id: undefined }, grams: 40 }, { food: { ...BREAD, id: undefined }, grams: 40 }],
    foods: [mine],
    newId,
  });
  assert.deepEqual(lines.map((l) => l.food.id), ['f-oats', 'f-mine-milk', 'id1', 'id1']);
  assert.deepEqual(foods.map((f) => [f.id, f.name, f.useCount, f.userEdited]), [['id1', 'White bread', 0, 0]]);
  assert.deepEqual(storedLines(lines), [{ foodId: 'f-oats', grams: 80 }, { foodId: 'f-mine-milk', grams: 400 }, { foodId: 'id1', grams: 40 }, { foodId: 'id1', grams: 40 }]);
});

test('stored lines come back with their foods, a deleted food included and a missing one left out', () => {
  const lines = linesWithFoods([{ foodId: 'f-oats', grams: 80 }, { foodId: 'gone', grams: 5 }, { foodId: 'f-milk', grams: 200 }], [OATS, { ...MILK, deletedAt: 3 }]);
  assert.deepEqual(lines.map((l) => [l.food.id, l.grams]), [['f-oats', 80], ['f-milk', 200]]);
});

test('lines together: unknowns carried, "~" when a food is an estimate, nothing until every line has grams', () => {
  const t = linesTotal([{ food: OATS, grams: 80 }, { food: HONEY, grams: 21 }]);
  assert.equal(t.amounts.kcalMilli, 300_000 + 63_840);
  assert.equal(t.estimated, true);
  assert.deepEqual(t.amounts.unknown, { fibreUg: 1, saltUg: 1 });
  assert.equal(linesTotal([{ food: OATS, grams: 80 }]).estimated, false);
  assert.equal(linesTotal([{ food: OATS, grams: null }]), null);
  assert.equal(linesTotal([]), null);
});
