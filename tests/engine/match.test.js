import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, nameWords, rankFoods, stateFits } from '../../src/engine/match.js';

test('names: accents, case and punctuation fold away', () => {
  assert.equal(normaliseName('  Crème Fraîche, half-fat '), 'creme fraiche half fat');
  assert.deepEqual(nameWords('Eggs, eggs and glass'), ['egg', 'and', 'glass']);
});

test('match: every word of the search must be in the name, plurals folded', () => {
  const foods = [{ name: 'Egg, chicken, whole, raw', state: 'raw' }, { name: 'Egg fried rice', state: 'cooked' }, { name: 'Toast' }];
  assert.deepEqual(rankFoods('eggs', foods).map((f) => f.name), ['Egg fried rice', 'Egg, chicken, whole, raw']);
  assert.deepEqual(rankFoods('fried egg', foods).map((f) => f.name), ['Egg fried rice']);
  assert.deepEqual(rankFoods('bagel', foods), []);
  assert.deepEqual(rankFoods('  ', foods), []);
});

test('match: a food in the other state never matches; as sold fits either', () => {
  const foods = [{ name: 'Rice, white, raw', state: 'raw' }, { name: 'Rice, white, boiled', state: 'cooked' }, { name: 'Rice pot', state: 'asSold' }];
  assert.deepEqual(rankFoods('rice', foods, { state: 'cooked' }).map((f) => f.name), ['Rice pot', 'Rice, white, boiled']);
  assert.equal(stateFits('raw', 'cooked'), false);
  assert.equal(stateFits(null, 'cooked'), true);
  assert.equal(stateFits('asSold', 'raw'), true);
});

test('match: ties go to the most used food, then the shorter name, in a fixed order', () => {
  const foods = [{ name: 'Oat milk B', useCount: 1 }, { name: 'Oat milk A', useCount: 1 }, { name: 'Oat milk Z', useCount: 9 }];
  assert.deepEqual(rankFoods('oat milk', foods).map((f) => f.name), ['Oat milk Z', 'Oat milk A', 'Oat milk B']);
});

test('match: among equally close names, the whole food beats its parts', () => {
  const foods = [{ name: 'Eggs, chicken, yolk, boiled' }, { name: 'Eggs, chicken, white, boiled' }, { name: 'Eggs, chicken, whole, boiled' }];
  assert.equal(rankFoods('boiled egg', foods)[0].name, 'Eggs, chicken, whole, boiled');
  assert.equal(rankFoods('egg yolk', foods)[0].name, 'Eggs, chicken, yolk, boiled');
});

test('match: the brand counts as part of the name', () => {
  assert.deepEqual(rankFoods('hovis', [{ name: 'Soft White Medium', brand: 'Hovis' }]).length, 1);
});
