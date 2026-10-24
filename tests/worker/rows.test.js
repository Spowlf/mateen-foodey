import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, food, entry, NOW } from './helpers.js';

test('sync: the first request seeds default settings, once', async () => {
  const w = makeWorker();
  const { status, body } = await w.call('GET', '/sync?since=0');
  assert.equal(status, 200);
  assert.ok(body.rev > 0);
  assert.equal(body.today, undefined);   // the Worker never works out today
  const settings = Object.fromEntries(body.changes.settings.map((s) => [s.id, s.value]));
  assert.deepEqual(settings, {
    floorKcal: 1500, exerciseAddBackPct: 50, weightUnit: 'kg', sources: { off: true, cofid: true, sgfoodid: true, usda: true },
    mealTimes: { breakfast: '04:00', lunch: '12:00', dinner: '18:00' },
  });
  await w.call('PUT', '/settings/floorKcal', { body: { value: 1600 } });
  await w.call('GET', '/sync?since=0');
  assert.equal(JSON.parse(w.rows('settings', 'id = ?', 'floorKcal')[0].value), 1600);
});

test('sync: since=rev returns only what changed after it, deletes included', async () => {
  const w = makeWorker();
  const first = (await w.call('GET', '/sync?since=0')).body;
  const none = (await w.call('GET', `/sync?since=${first.rev}`)).body;
  assert.equal(none.rev, first.rev);
  for (const rows of Object.values(none.changes)) assert.deepEqual(rows, []);

  await w.call('PUT', '/pots/p1', { body: { name: 'Big pan', grams: 1200 } });
  const after = (await w.call('GET', `/sync?since=${first.rev}`)).body;
  assert.deepEqual(after.changes.pots.map((p) => [p.id, p.grams]), [['p1', 1200]]);
  assert.deepEqual(after.changes.settings, []);

  await w.call('DELETE', '/pots/p1');
  const deleted = (await w.call('GET', `/sync?since=${after.rev}`)).body;
  assert.ok(deleted.changes.pots[0].deletedAt > 0);
});

test('PUT: saving the same record twice leaves one record', async () => {
  const w = makeWorker();
  await w.call('PUT', '/foods/f-oats', { body: food() });
  for (let i = 0; i < 2; i++) assert.equal((await w.call('PUT', '/entries/e1', { body: entry() })).status, 200);
  assert.equal(w.rows('entries').length, 1);
  assert.equal(w.rows('foods').length, 1);
});

test('PUT: a body whose id differs from the address is refused and changes nothing', async () => {
  const w = makeWorker();
  await w.call('PUT', '/pots/p1', { body: { name: 'Big pan', grams: 1200 } });
  const before = w.rows('pots');
  const res = await w.call('PUT', '/pots/p1', { body: { id: 'p2', name: 'Small pan', grams: 400 } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Nothing changed: the record’s id doesn’t match its address.');
  assert.deepEqual(w.rows('pots'), before);
  assert.equal((await w.call('PUT', '/pots/p1', { body: { id: 'p1', grams: 1300 } })).status, 200);   // the same id is fine
});

test('PUT: a partial PUT keeps the fields it leaves out; DELETE is soft and PUT undoes it', async () => {
  const w = makeWorker();
  await w.call('PUT', '/pots/p1', { body: { name: 'Big pan', grams: 1200 } });
  const res = await w.call('PUT', '/pots/p1', { body: { grams: 1250 } });
  assert.deepEqual([res.body.changes.pots[0].name, res.body.changes.pots[0].grams], ['Big pan', 1250]);
  await w.call('DELETE', '/pots/p1');
  assert.ok(w.rows('pots')[0].deletedAt > 0);
  await w.call('PUT', '/pots/p1', { body: { deletedAt: null } });
  assert.equal(w.rows('pots')[0].deletedAt, null);
  assert.equal((await w.call('DELETE', '/pots/nope')).status, 404);
});

test('PUT: rows are checked, and a refused one changes nothing', async () => {
  const w = makeWorker();
  const cases = [
    ['/entries/e1', entry({ foodId: null, grams: 5001 }), 'Nothing changed: enter grams from 1 to 5,000.'],
    ['/entries/e1', entry({ foodId: null, grams: 0 }), 'Nothing changed: enter grams from 1 to 5,000.'],
    ['/entries/e1', entry({ foodId: null, date: '2026-02-30' }), 'Nothing changed: pick the date.'],
    ['/foods/f1', food({ per100g: { kcalTenths: 1.5 } }), 'Nothing changed: enter nutrition per 100 g from 0 to 100 g, and energy up to 900 kcal.'],
    ['/weights/2026-10-23', { date: '2026-10-22', grams: 72400 }, 'Nothing changed: pick the date of the weigh-in.'],
    ['/targets/2026-10-19', { fromDate: '2026-10-19', mode: 'adaptive', kcal: 2100, goalRateG: -1000 }, 'Nothing changed: pick a goal from the list.'],
    ['/settings/mealTimes', { value: { breakfast: '07:00', lunch: '06:00', dinner: '17:00', snacks: '21:00' } }, 'Nothing changed: put the meal times in order through the day.'],
    ['/settings/colour', { value: 'green' }, 'Nothing changed: that setting doesn’t exist.'],
    ['/days/2026-10-22', { state: 'done' }, 'Nothing changed: mark the day complete or incomplete.'],
  ];
  for (const [path, body, message] of cases) {
    const res = await w.call('PUT', path, { body });
    assert.equal(res.status, 400, path);
    assert.equal(res.body.error, message);
  }
  for (const t of ['entries', 'foods', 'weights', 'targets', 'days']) assert.equal(w.rows(t).length, 0, t);
});

test('PUT: a live row naming a food that isn’t saved is refused, so every backup restores', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/entries/e1', { body: entry({ foodId: 'f-missing' }) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Nothing changed: an entry names a food that isn’t saved yet.');
  const meal = await w.call('PUT', '/savedMeals/m1', { body: { name: 'Breakfast', items: [{ foodId: 'f-missing', grams: 50 }] } });
  assert.equal(meal.body.error, 'Nothing changed: a saved meal names a food that isn’t saved yet.');
  const fromMeal = await w.call('PUT', '/entries/e2', { body: entry({ foodId: null, savedMealId: 'm-missing' }) });
  assert.equal(fromMeal.body.error, 'Nothing changed: an entry names a saved meal that isn’t saved yet.');
  // A deleted food still counts: old entries keep naming it.
  await w.call('PUT', '/foods/f-oats', { body: food() });
  await w.call('DELETE', '/foods/f-oats');
  assert.equal((await w.call('PUT', '/entries/e1', { body: entry() })).status, 200);
});

test('PUT: one live food per source food', async () => {
  const w = makeWorker();
  await w.call('PUT', '/foods/f1', { body: food() });
  const res = await w.call('PUT', '/foods/f2', { body: food() });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'Nothing changed: that food is already in your foods.');
  assert.equal(w.rows('foods').length, 1);
});

test('food memory: a logged entry updates its food in the same write, once however often it’s retried', async () => {
  const w = makeWorker();
  await w.call('PUT', '/foods/f-oats', { body: food({ usualGrams: 40, useCount: 3 }) });
  const res = await w.call('PUT', '/entries/e1', { body: entry({ grams: 55 }) });
  const f = res.body.changes.foods[0];
  assert.deepEqual([f.usualGrams, f.useCount, f.lastUsedAt], [55, 4, NOW]);
  assert.equal(res.body.changes.entries[0].rev, f.rev);
  await w.call('PUT', '/entries/e1', { body: entry({ grams: 55 }) });
  assert.equal(w.rows('foods')[0].useCount, 4);
});

test('food memory: a To check entry doesn’t count until it’s confirmed', async () => {
  const w = makeWorker();
  await w.call('PUT', '/foods/f-oats', { body: food({ usualGrams: 40, useCount: 3 }) });
  await w.call('PUT', '/entries/e1', { body: entry({ grams: 120, status: 'toCheck', portionBasis: 'guessed', origin: 'shortcut' }) });
  assert.deepEqual([w.rows('foods')[0].usualGrams, w.rows('foods')[0].useCount], [40, 3]);
  await w.call('PUT', '/entries/e1', { body: { status: 'logged', grams: 60, portionBasis: 'typed' } });
  assert.deepEqual([w.rows('foods')[0].usualGrams, w.rows('foods')[0].useCount], [60, 4]);
});

test('batch: new foods and their entries land together, or nothing does', async () => {
  const w = makeWorker();
  const ok = await w.call('POST', '/batch', {
    body: { foods: [{ ...food(), id: 'f-oats' }], entries: [{ ...entry(), id: 'e1' }, { ...entry({ grams: 30 }), id: 'e2' }] },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.changes.foods.length, 1);
  assert.deepEqual([w.rows('foods')[0].useCount, w.rows('foods')[0].usualGrams], [2, 30]);
  assert.equal(w.rows('entries').length, 2);

  const bad = await w.call('POST', '/batch', {
    body: { foods: [{ ...food({ sourceId: '11-002' }), id: 'f-2' }], entries: [{ ...entry({ foodId: 'f-2' }), id: 'e3' }, { ...entry({ grams: -1 }), id: 'e4' }] },
  });
  assert.equal(bad.status, 400);
  assert.equal(w.rows('foods').length, 1);
  assert.equal(w.rows('entries').length, 2);
});

test('batch: Mark N Days Complete writes the days in one go', async () => {
  const w = makeWorker();
  const days = ['2026-10-19', '2026-10-20', '2026-10-21'].map((id) => ({ id, state: 'complete' }));
  const res = await w.call('POST', '/batch', { body: { days } });
  assert.equal(res.body.changes.days.length, 3);
  assert.equal(new Set(res.body.changes.days.map((d) => d.rev)).size, 1);
});

test('batch: rows need ids, each once', async () => {
  const w = makeWorker();
  assert.equal((await w.call('POST', '/batch', { body: { pots: [{ name: 'Pan', grams: 1 }] } })).body.error, 'Nothing changed: send each row with its id.');
  assert.equal((await w.call('POST', '/batch', { body: { pots: [{ id: 'p', name: 'Pan', grams: 1 }, { id: 'p', name: 'Pan', grams: 2 }] } })).body.error, 'Nothing changed: send each row once.');
  assert.equal((await w.call('POST', '/batch', { body: {} })).body.error, 'Nothing changed: send at least one row.');
});

test('PUT: a saved meal item is a food or a recipe, and the recipe must be saved', async () => {
  const w = makeWorker();
  await w.call('PUT', '/foods/f-oats', { body: food() });
  const missing = await w.call('PUT', '/savedMeals/m1', { body: { name: 'Lunch', items: [{ recipeId: 'r-missing', grams: 200 }] } });
  assert.equal(missing.body.error, 'Nothing changed: a saved meal names a recipe that isn’t saved yet.');
  const both = await w.call('PUT', '/savedMeals/m1', { body: { name: 'Lunch', items: [{ foodId: 'f-oats', recipeId: 'r1', grams: 200 }] } });
  assert.equal(both.body.error, 'Nothing changed: add at least one food or recipe, each with its grams.');
  await w.call('PUT', '/recipes/r1', { body: { name: 'Chilli', ingredients: [{ foodId: 'f-oats', grams: 100 }] } });
  const ok = await w.call('PUT', '/savedMeals/m1', { body: { name: 'Lunch', items: [{ foodId: 'f-oats', grams: 40 }, { recipeId: 'r1', grams: 200 }] } });
  assert.equal(ok.status, 200);
});

test('batch: a few calls to D1 however many rows, within the Free plan’s 50 a request', async () => {
  const w = makeWorker();
  await w.call('GET', '/sync?since=0');
  const foods = Array.from({ length: 150 }, (_, i) => ({ ...food({ sourceId: `s${i}`, name: `Food ${i}` }), id: `f${i}` }));
  let before = w.queries();
  assert.equal((await w.call('POST', '/batch', { body: { foods } })).status, 200);
  assert.ok(w.queries() - before <= 4, `${w.queries() - before} calls`);
  // Entries naming saved foods, as Copy to Today sends: each food's memory is updated too.
  const entries = Array.from({ length: 300 }, (_, i) => ({ ...entry({ foodId: `f${i % 150}` }), id: `e${i}` }));
  before = w.queries();
  assert.equal((await w.call('POST', '/batch', { body: { entries } })).status, 200);
  assert.ok(w.queries() - before <= 4, `${w.queries() - before} calls`);
  assert.equal(w.rows('foods', 'id = ?', 'f7')[0].useCount, 2);
  // A food that isn't saved is still refused.
  const res = await w.call('POST', '/batch', { body: { entries: [{ ...entry({ foodId: 'nope' }), id: 'e-x' }] } });
  assert.equal(res.status, 400);
});

test('PUT: a food from SG FoodID can be saved', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/foods/f-kopi', { body: food({ name: 'Kopi', source: 'sgfoodid', sourceId: 'D09010035', state: 'asSold' }) });
  assert.equal(res.status, 200);
  assert.equal(w.rows('foods')[0].source, 'sgfoodid');
});
