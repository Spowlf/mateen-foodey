import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyDays, dayLine, copyEntries, rescaleEntry, stateLabel } from '../../src/engine/history.js';
import { settingProblem, targetFromSettings, typedWhole } from '../../src/engine/settings.js';
import { foodEntry } from '../../src/engine/entries.js';
import { eaten, day, OATS, HONEY } from './fixtures.js';

test('history: days newest first, meals in order, entries as logged; a search keeps only what matches', () => {
  const entries = [
    eaten('2026-10-22', 300, { meal: 'dinner', name: 'Chilli', createdAt: 5 }),
    eaten('2026-10-22', 200, { meal: 'breakfast', name: 'Porridge oats', createdAt: 2 }),
    eaten('2026-10-22', 100, { meal: 'breakfast', name: 'Boiled eggs', createdAt: 1 }),
    eaten('2026-10-23', 150, { meal: 'lunch', name: 'Egg sandwich', createdAt: 9 }),
    eaten('2026-10-21', 150, { meal: 'lunch', name: 'Gone', deletedAt: 3 }),
  ];
  const days = historyDays({ entries, days: [day('2026-10-22', 'complete')] });
  assert.deepEqual(days.map((d) => [d.date, d.state]), [['2026-10-23', 'unreviewed'], ['2026-10-22', 'complete']]);
  assert.deepEqual(days[1].meals.map((m) => [m.meal, m.entries.map((e) => e.name)]), [['breakfast', ['Boiled eggs', 'Porridge oats']], ['dinner', ['Chilli']]]);
  const found = historyDays({ entries, days: [], query: 'eggs' });
  assert.deepEqual(found.map((d) => d.meals.flatMap((m) => m.entries.map((e) => e.name))), [['Egg sandwich'], ['Boiled eggs']]);
  assert.deepEqual(historyDays({ entries, days: [], query: 'haggis' }), []);
});

test('history: a day’s line, with "~" when anything in it is estimated', () => {
  const entries = [eaten('2026-10-22', 1800, { proteinG: 92 }), eaten('2026-10-22', 40, { status: 'toCheck' })];
  assert.equal(dayLine(entries, '2026-10-22', 2000), '~1,840 of 2,000 kcal, 92 g protein');
  assert.equal(dayLine([eaten('2026-10-21', 500)], '2026-10-21'), '500 kcal');
  assert.deepEqual(['complete', 'unreviewed'].map((s) => stateLabel(s, '2026-10-22', '2026-10-23')), ['Complete', 'Unreviewed']);
  assert.equal(stateLabel('unreviewed', '2026-10-23', '2026-10-23'), null);   // today is never marked
});

test('copy to today: new ids and today’s date, everything else as it was, To check kept to check', () => {
  let n = 0;
  const from = [eaten('2026-10-20', 300, { meal: 'lunch', batchId: 'b1', rev: 7, updatedAt: 5 }), eaten('2026-10-20', 50, { status: 'toCheck' }), eaten('2026-10-20', 9, { deletedAt: 1 })];
  const copies = copyEntries(from, { date: '2026-10-23', newId: () => `c${++n}`, now: 99 });
  assert.deepEqual(copies.map((e) => [e.id, e.date, e.createdAt, e.meal, e.batchId, e.status]), [['c1', '2026-10-23', 99, 'lunch', 'b1', 'logged'], ['c2', '2026-10-23', 99, 'lunch', null, 'toCheck']]);
  assert.deepEqual(copies[0].nutrition, from[0].nutrition);
  assert.ok(copies.every((e) => !('rev' in e) && !('updatedAt' in e)));
});

test('weighing an entry again scales its own copied nutrition, never its food’s current figures', () => {
  const entry = foodEntry({ id: 'e', food: HONEY, grams: 21, date: '2026-10-23', meal: 'breakfast', portionBasis: 'guessed', createdAt: 1 });
  const changes = rescaleEntry(entry, 30);
  assert.equal(changes.nutrition.kcalMilli, 3040 * 30);
  assert.equal(changes.nutrition.fibreUg, null);              // unknown stays unknown
  assert.deepEqual([changes.grams, changes.portionBasis], [30, 'typed']);
  const odd = rescaleEntry({ ...foodEntry({ id: 'o', food: OATS, grams: 3, date: '2026-10-23', meal: 'lunch', portionBasis: 'typed', createdAt: 1 }) }, 2);
  assert.equal(odd.nutrition.kcalMilli, 3750 * 2);
  assert.throws(() => rescaleEntry(entry, 0), RangeError);
  assert.throws(() => rescaleEntry({ ...entry, grams: null }, 10), RangeError);
});

test('settings: the same checks on the phone and the Worker', () => {
  assert.equal(settingProblem('floorKcal', 1500), null);
  assert.equal(settingProblem('floorKcal', 700), 'enter a floor from 800 to 4,000 kcal.');
  assert.equal(settingProblem('mealTimes', { breakfast: '04:00', lunch: '11:00', dinner: '10:00', snacks: '21:00' }), 'put the meal times in order through the day.');
  assert.equal(settingProblem('nope', 1), 'that setting doesn’t exist.');
  assert.deepEqual(['12', ' 7 ', '1.5', ''].map(typedWhole), [12, 7, null, null]);
});

test('settings: a target from today, fixed as typed, adaptive from the estimate once it’s ready', () => {
  const base = { fromDate: '2026-10-23', kcalText: '2000', proteinText: '120', carbsText: '', fatText: '', goalRateG: -500 };
  assert.deepEqual(targetFromSettings({ ...base, mode: 'fixed' }).row,
    { id: '2026-10-23', fromDate: '2026-10-23', mode: 'fixed', kcal: 2000, proteinG: 120, carbsG: null, fatG: null, goalRateG: -500, deletedAt: null });
  assert.equal(targetFromSettings({ ...base, mode: 'adaptive', estimate: { ok: true, kcal: 2400 } }).row.kcal, 1850);
  assert.equal(targetFromSettings({ ...base, mode: 'adaptive', estimate: { ok: true, kcal: 1800 } }).row.kcal, 1500);   // the floor
  assert.equal(targetFromSettings({ ...base, mode: 'adaptive', estimate: { ok: false } }).row.kcal, 2000);
  assert.deepEqual(targetFromSettings({ ...base, mode: 'fixed', kcalText: '' }), { error: 'Enter a daily target from 500 to 10,000 kcal.' });
  assert.deepEqual(targetFromSettings({ ...base, mode: 'fixed', proteinText: '' }), { error: 'Enter a protein target from 0 to 1,000 g.' });
  assert.deepEqual(targetFromSettings({ ...base, mode: 'fixed', fatText: 'x' }), { error: 'Enter carbs and fat from 0 to 1,000 g, or leave them blank.' });
  assert.deepEqual(targetFromSettings({ ...base, mode: 'fixed', goalRateG: -1000 }), { error: 'Pick a goal.' });
});
