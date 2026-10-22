import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanParse, cleanEstimate, needsEstimate, checkLine, withGrams, uncertainty, nutritionBasisFor, portionBasisFor } from '../../src/engine/parse.js';
import { foodEntry } from '../../src/engine/entries.js';
import { OATS, HONEY } from './fixtures.js';

test('parse validation: grams above zero and at most 5,000; unknown fields and nutrition dropped', () => {
  const items = cleanParse({
    items: [
      { name: 'eggs', quantity: 2, unit: null, grams: 120, gramsAssumed: false, state: 'raw', searchTerm: 'egg', kcal: 180, protein: 15, per100g: { kcalTenths: 1 }, extra: 'x' },
      { name: 'toast', quantity: 1, unit: 'slice', grams: 0, gramsAssumed: true, state: 'cooked', searchTerm: 'toast' },
      { name: 'flat white', quantity: 1, unit: null, grams: 5001, gramsAssumed: true, state: 'asSold', searchTerm: 'flat white' },
      { name: '  ', grams: 50 },
      { name: 'butter', grams: 10.4, gramsAssumed: true, state: 'melted' },
      { name: 'rice', grams: 5000, gramsAssumed: false, state: 'cooked', searchTerm: 'rice' },
    ],
  });
  assert.deepEqual(items.map((i) => i.name), ['eggs', 'toast', 'flat white', 'butter', 'rice']);
  assert.deepEqual(Object.keys(items[0]).sort(), ['grams', 'gramsAssumed', 'name', 'quantity', 'searchTerm', 'state', 'unit']);
  assert.deepEqual(items.map((i) => i.grams), [120, null, null, 10, 5000]);
  assert.equal(items[3].state, null);
  assert.equal(items[3].searchTerm, 'butter');
  assert.deepEqual(cleanParse({ nothing: true }), []);
  assert.deepEqual(cleanParse(null), []);
});

test('estimates: only for items nothing matched', () => {
  const lines = [{ name: 'oats', food: OATS }, { name: 'nonna’s ragu', food: null }];
  assert.deepEqual(needsEstimate(lines).map((l) => l.name), ['nonna’s ragu']);
});

test('estimates: per-100 g nutrition with its assumptions, checked', () => {
  const [ragu, ...rest] = cleanEstimate({
    items: [
      { name: 'Ragu', kcal: 145.5, protein: 9, carbs: 6, fat: 8.5, fibre: null, sugars: 4, salt: 120, assumptions: 'Assumed beef mince with tomato.' },
      { name: 'Impossible', kcal: 2000, protein: 1, carbs: 1, fat: 1, fibre: 1, sugars: 1, salt: 1, assumptions: '' },
    ],
  });
  assert.equal(rest.length, 0);
  assert.deepEqual(ragu.per100g, { kcalTenths: 1455, proteinMg: 9000, carbsMg: 6000, fatMg: 8500, fibreMg: null, sugarsMg: 4000, saltMg: null });
  assert.deepEqual([ragu.source, ragu.assumptions], ['estimate', 'Assumed beef mince with tomato.']);
});

test('basis: nutrition from a database or an estimate; portion guessed or typed', () => {
  assert.equal(nutritionBasisFor(OATS), 'database');
  assert.equal(nutritionBasisFor(HONEY), 'estimate');
  assert.equal(portionBasisFor({ gramsAssumed: true }), 'guessed');
  assert.equal(portionBasisFor({ gramsAssumed: false }), 'typed');
  assert.equal(portionBasisFor({ gramsAssumed: false, origin: 'photo' }), 'guessed');
});

test('basis: a guessed portion becomes typed when you edit the grams', () => {
  const line = checkLine({ name: 'porridge', grams: 250, gramsAssumed: true }, HONEY);
  assert.equal(line.portionBasis, 'guessed');
  assert.deepEqual(uncertainty(line), ['~ Estimated nutrition', '~ Portion guessed']);
  const edited = withGrams(line, 300);
  assert.deepEqual([edited.grams, edited.portionBasis], [300, 'typed']);
  assert.deepEqual(uncertainty(edited), ['~ Estimated nutrition']);
  const entry = foodEntry({ id: 'e1', food: edited.food, grams: edited.grams, date: '2026-10-23', meal: 'breakfast', portionBasis: edited.portionBasis, origin: 'sentence', createdAt: 1 });
  assert.deepEqual([entry.nutritionBasis, entry.portionBasis, entry.assumptions], ['estimate', 'typed', 'Assumed clear honey.']);
});

test('basis: a portion the sentence gave is typed, and a matched food is from the database', () => {
  const line = checkLine({ name: 'oats', grams: 40, gramsAssumed: false }, OATS);
  assert.deepEqual(uncertainty(line), []);
  const entry = foodEntry({ id: 'e2', food: OATS, grams: 40, date: '2026-10-23', meal: 'breakfast', portionBasis: line.portionBasis, origin: 'sentence', createdAt: 1 });
  assert.deepEqual([entry.nutritionBasis, entry.portionBasis], ['database', 'typed']);
});

test('basis: photo portions are guessed until edited', () => {
  const line = checkLine({ name: 'pasta', grams: 300, gramsAssumed: false }, OATS, { origin: 'photo' });
  assert.equal(line.portionBasis, 'guessed');
  assert.equal(withGrams(line, 280).portionBasis, 'typed');
});
