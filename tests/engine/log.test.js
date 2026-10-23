import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickLogItems, toCheckEntries, checkButton, logLines, figuresText, lineAmounts, lineEstimated, eatenLine } from '../../src/engine/log.js';
import { OATS, MILK, HONEY, BREAD, eaten } from './fixtures.js';

const own = (food, extra = {}) => ({ ...food, usualGrams: 50, useCount: 1, lastUsedAt: 0, userEdited: 0, deletedAt: null, ...extra });
const ate = (foodId, meal, date = '2026-10-20', extra = {}) => eaten(date, 100, { foodId, meal, ...extra });

test('quick log: foods most logged in this meal slot come first, then overall, then most recent', () => {
  const foods = [own(OATS), own(MILK, { lastUsedAt: 5 }), own(BREAD, { lastUsedAt: 9 }), own(HONEY)];
  const entries = [
    ate('f-oats', 'breakfast'), ate('f-oats', 'breakfast'),
    ate('f-bread', 'lunch'), ate('f-bread', 'lunch'), ate('f-bread', 'lunch'),
    ate('f-milk', 'breakfast'), ate('f-milk', 'snacks'),
    ate('f-honey', 'lunch', '2026-06-01'),                 // over 90 days ago
    ate('f-honey', 'breakfast', '2026-10-21', { status: 'toCheck' }),   // not confirmed
  ];
  const at = (meal) => quickLogItems({ entries, foods, meal, today: '2026-10-23' }).map((c) => c.food.id);
  assert.deepEqual(at('breakfast'), ['f-oats', 'f-milk', 'f-bread']);
  // Oats and milk are logged twice each overall: milk was used more recently.
  assert.deepEqual(at('lunch'), ['f-bread', 'f-milk', 'f-oats']);
  assert.deepEqual(at('dinner'), ['f-bread', 'f-milk', 'f-oats']);
  assert.deepEqual(quickLogItems({ entries, foods, meal: 'breakfast', today: '2026-10-23' })[0].grams, 50);
});

test('quick log: deleted foods and foods with no usual portion are left out', () => {
  const foods = [own(OATS, { deletedAt: 1 }), own(MILK, { usualGrams: null })];
  assert.deepEqual(quickLogItems({ entries: [ate('f-oats', 'lunch'), ate('f-milk', 'lunch')], foods, meal: 'lunch', today: '2026-10-23' }), []);
});

test('To check: live To check entries, newest first', () => {
  const list = toCheckEntries([
    eaten('2026-10-22', 100, { status: 'toCheck', createdAt: 1 }), eaten('2026-10-23', 100, { status: 'toCheck', createdAt: 2 }),
    eaten('2026-10-23', 100, { status: 'toCheck', createdAt: 3, deletedAt: 9 }), eaten('2026-10-23', 100),
  ]);
  assert.deepEqual(list.map((e) => [e.date, e.createdAt]), [['2026-10-23', 2], ['2026-10-22', 1]]);
});

test('check sheet: the button says what’s missing, then how many it logs', () => {
  assert.deepEqual(checkButton([]), { ready: false, label: 'Add a Food' });
  assert.deepEqual(checkButton([{ name: 'haggis', food: null, grams: 100 }]), { ready: false, label: 'Pick a Food for Haggis' });
  assert.deepEqual(checkButton([{ name: 'Oats', food: OATS, grams: null }]), { ready: false, label: 'Enter the Grams' });
  assert.deepEqual(checkButton([{ name: 'Oats', food: OATS, grams: 5001 }]), { ready: false, label: 'Enter the Grams' });
  assert.deepEqual(checkButton([{ name: 'Oats', food: OATS, grams: 50 }]), { ready: true, label: 'Log 1 Item' });
  assert.equal(checkButton([1, 2, 3].map(() => ({ name: 'Oats', food: OATS, grams: 50 }))).label, 'Log 3 Items');
});

test('check sheet: figures for a line, with "~" when it’s estimated, and unknown parts left out', () => {
  const line = { food: HONEY, grams: 20, portionBasis: 'typed' };
  assert.equal(lineEstimated(line), true);
  assert.equal(figuresText(lineAmounts(line), { estimated: true }), '~61 kcal, 0 g protein, 16 g carbs, 0 g fat');
  assert.equal(lineEstimated({ food: OATS, portionBasis: 'guessed' }), true);
  assert.equal(lineEstimated({ food: OATS, portionBasis: 'typed' }), false);
  const unknown = { ...OATS, per100g: { ...OATS.per100g, proteinMg: null } };
  assert.equal(figuresText(lineAmounts({ food: unknown, grams: 40 })), '150 kcal, 24 g carbs, 3 g fat');
  assert.equal(lineAmounts({ food: OATS, grams: null }), null);
});

test('check sheet: a line with the kcal you gave needs no food or grams, and isn’t an estimate', () => {
  const line = { name: 'Popeyes 2 piece', food: null, grams: null, kcal: 780, portionBasis: 'guessed' };
  assert.deepEqual(checkButton([line]), { ready: true, label: 'Log 1 Item' });
  assert.equal(lineEstimated(line), false);
  assert.equal(figuresText(lineAmounts(line)), '780 kcal');
  assert.equal(checkButton([line], 'add').ready, false);   // a recipe or saved meal needs foods and grams
});

test('log lines: a line with the kcal you gave is saved like a quick add, on its own name', () => {
  let n = 0;
  const lines = [{ name: 'Popeyes 2 piece', food: null, grams: null, kcal: 780, portionBasis: 'guessed' }, { name: 'Oats', food: own(OATS), grams: 40, portionBasis: 'typed' }];
  const { foods, entries } = logLines({ lines, foods: [], date: '2026-10-23', meal: 'dinner', origin: 'sentence', newId: () => `id${++n}`, now: 7 });
  assert.equal(foods.length, 0);
  const [e] = entries;
  assert.deepEqual([e.name, e.foodId, e.grams, e.nutritionBasis, e.portionBasis, e.origin, e.status, e.meal], ['Popeyes 2 piece', null, null, 'quick', null, 'sentence', 'logged', 'dinner']);
  assert.equal(e.nutrition.kcalMilli, 780_000);
  assert.equal(e.nutrition.proteinUg, null);
  assert.equal(entries[1].foodId, 'f-oats');
});

test('log lines: your food is used, a source food you have is reused, the rest become new foods', () => {
  let n = 0;
  const newId = () => `id${++n}`;
  const mine = own(OATS);
  const lines = [
    { name: 'Oats', food: mine, grams: 40, portionBasis: 'typed' },
    { name: 'Milk', food: { ...MILK, id: undefined }, grams: 200, portionBasis: 'guessed' },
    { name: 'Bread', food: { ...BREAD, id: undefined }, grams: 80, portionBasis: 'serving' },
    { name: 'Bread again', food: { ...BREAD, id: undefined }, grams: 40, portionBasis: 'typed' },
    { name: 'Honey', food: { ...HONEY, id: undefined }, grams: 20, portionBasis: 'typed' },
  ];
  const { foods, entries } = logLines({ lines, foods: [mine, own(MILK, { id: 'f-mine-milk' })], date: '2026-10-23', meal: 'breakfast', origin: 'sentence', newId, now: 7 });
  assert.deepEqual(entries.map((e) => e.foodId), ['f-oats', 'f-mine-milk', foods[0].id, foods[0].id, foods[1].id]);
  assert.deepEqual(foods.map((f) => [f.name, f.source, f.useCount, f.userEdited]), [['White bread', 'off', 0, 0], ['Honey', 'estimate', 0, 0]]);
  assert.equal(foods[1].assumptions, 'Assumed clear honey.');
  assert.deepEqual(entries.map((e) => e.portionBasis), ['typed', 'guessed', 'serving', 'typed', 'typed']);
  assert.deepEqual(entries.map((e) => e.nutritionBasis), ['database', 'database', 'database', 'database', 'estimate']);
  assert.ok(entries.every((e) => e.date === '2026-10-23' && e.meal === 'breakfast' && e.origin === 'sentence' && e.status === 'logged' && e.createdAt === 7));
  assert.equal(entries[4].assumptions, 'Assumed clear honey.');
  assert.equal(entries[0].nutrition.kcalMilli, 3750 * 40);
});

test('eaten line: today’s kcal when there’s no target', () => {
  assert.equal(eatenLine([eaten('2026-10-23', 1240), eaten('2026-10-22', 500)], '2026-10-23'), '1,240 kcal eaten today.');
  assert.equal(eatenLine([], '2026-10-23'), '0 kcal eaten today.');
});

test('number pad: whole grams from 1 to 5,000, no leading zero', async () => {
  const { pressGramsKey, typedGrams } = await import('../../src/engine/log.js');
  const typed = (keys) => keys.reduce(pressGramsKey, '');
  assert.equal(typed(['1', '5', '0']), '150');
  assert.equal(typed(['0', '4']), '4');
  assert.equal(typed(['5', '0', '0', '0', '1']), '5000');
  assert.equal(typed(['6', '0', '0', '0']), '600');
  assert.equal(typed(['1', '2', 'back']), '1');
  assert.equal(typed(['back', '.']), '');
  assert.deepEqual(['150', '', '0', null].map(typedGrams), [150, null, null, null]);
});

test('synced: when the copy on screen was last synced', async () => {
  const { syncedPhrase } = await import('../../src/engine/log.js');
  const now = new Date(2026, 9, 23, 18, 0);
  assert.equal(syncedPhrase(null, now), 'Not synced yet');
  assert.equal(syncedPhrase(new Date(2026, 9, 23, 8, 15).getTime(), now), 'Last synced today at 08:15');
  assert.equal(syncedPhrase(new Date(2026, 8, 30, 8, 15).getTime(), now), 'Last synced 30 Sep 2026 at 08:15');
});

test('quick log: live batches with something left come first, then foods and saved meals by use in this slot', () => {
  const foods = [own(OATS), own(MILK)];
  const savedMeals = [
    { id: 'm-brekkie', name: 'Brekkie', items: [{ foodId: 'f-oats', grams: 50 }, { foodId: 'f-milk', grams: 200 }], deletedAt: null },
    { id: 'm-new', name: 'A new one', items: [{ foodId: 'f-oats', grams: 50 }], deletedAt: null },
    { id: 'm-gone', name: 'Gone', items: [{ foodId: 'f-oats', grams: 50 }], deletedAt: 1 },
  ];
  const recipes = [{ id: 'r1', name: 'Chilli', deletedAt: null }];
  const batch = (id, date, finishedGrams) => ({ id, recipeId: 'r1', date, finishedGrams, deletedAt: null });
  const batches = [batch('b-old', '2026-10-01', 900), batch('b-new', '2026-10-22', 900), batch('b-eaten', '2026-10-21', 300), batch('b-left', '2026-10-20', 900)];
  // Brekkie logged twice at breakfast (two items each time: counted once a time), oats once on its own there.
  const brekkie = (date, createdAt) => [
    ate('f-oats', 'breakfast', date, { savedMealId: 'm-brekkie', createdAt }), ate('f-milk', 'breakfast', date, { savedMealId: 'm-brekkie', createdAt }),
  ];
  const entries = [
    ...brekkie('2026-10-20', 1), ...brekkie('2026-10-21', 2),
    ate('f-oats', 'breakfast'), ate('f-milk', 'lunch'), ate('f-milk', 'lunch'), ate('f-milk', 'lunch'),
    { ...ate(null, 'dinner', '2026-10-21'), batchId: 'b-eaten', grams: 300 },
  ];
  const items = (meal) => quickLogItems({ entries, foods, savedMeals, batches, recipes, meal, today: '2026-10-23' })
    .map((i) => (i.kind === 'batch' ? i.batch.id : i.kind === 'meal' ? i.savedMeal.id : i.food.id));
  assert.deepEqual(items('breakfast'), ['b-new', 'b-left', 'm-brekkie', 'f-oats', 'f-milk', 'm-new']);
  assert.deepEqual(items('lunch'), ['b-new', 'b-left', 'f-milk', 'm-brekkie', 'f-oats', 'm-new']);
  const first = quickLogItems({ entries, foods, savedMeals, batches, recipes, meal: 'breakfast', today: '2026-10-23' })[0];
  assert.equal(first.recipe.name, 'Chilli');
  assert.equal(quickLogItems({ entries, foods, savedMeals, batches, recipes, meal: 'breakfast', today: '2026-10-23', n: 3 }).length, 3);
});

test('log lines: entries from a saved meal say so', () => {
  let n = 0;
  const { entries } = logLines({ lines: [{ food: own(OATS), grams: 50 }], foods: [], date: '2026-10-23', meal: 'lunch', newId: () => `id${++n}`, now: 1, savedMealId: 'm1' });
  assert.equal(entries[0].savedMealId, 'm1');
  assert.equal(checkButton([{ name: 'Oats', food: OATS, grams: 50 }], 'add').label, 'Add 1 Item');
});

test('log lines: a saved meal’s recipe line is served from its batch, and needs one', async () => {
  const { batchLine, batchTotals } = await import('../../src/engine/recipes.js');
  const ingredients = [batchLine(OATS, 80), batchLine(MILK, 400)];
  const batch = { id: 'b1', recipeId: 'r1', date: '2026-10-20', ingredients, totals: batchTotals(ingredients), finishedGrams: 480, portions: null };
  const recipe = { id: 'r1', name: 'Overnight oats' };
  let n = 0;
  const { foods, entries } = logLines({ lines: [{ recipe, batch, grams: 120 }], foods: [], date: '2026-10-23', meal: 'lunch', newId: () => `id${++n}`, now: 1, savedMealId: 'm1' });
  assert.equal(foods.length, 0);
  assert.deepEqual([entries[0].batchId, entries[0].foodId, entries[0].name, entries[0].grams, entries[0].savedMealId], ['b1', null, 'Overnight oats', 120, 'm1']);
  assert.equal(entries[0].nutrition.kcalMilli, Math.round(batch.totals.kcalMilli / 4));
  assert.throws(() => logLines({ lines: [{ recipe, batch: null, grams: 120 }], foods: [], date: '2026-10-23', meal: 'lunch', newId: () => 'x', now: 1 }), /Make Overnight oats first/);
});
