import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl, sgFoods, sgSql, summary, API } from '../../scripts/import-sgfoodid.js';
import { fakeD1 } from '../../scripts/sqlite-d1.js';

const food = (crId, name, energy, extra = {}) => ({
  crId, name, category: 'Food', defaultPortion: '1 plate(s) = 300g', alternativePortions: '-',
  baseFoodNutrients: { energy, protein: 5, fat: 3, carbohydrate: 20, sugar: -1, dietaryFibre: null, sodium: 400 }, ...extra,
});

/**
 * SG FoodID's website as the script sees it: two food groups (one over two pages) and the drinks,
 * with a food listed in two groups, one without energy, and one detail that fails once.
 */
function site() {
  const list = {
    5: [...Array.from({ length: 25 }, (_, i) => ({ crId: `F${i}` })), { crId: 'F25' }],
    6: [{ crId: 'F0' }, { crId: 'FX' }],
    Drink: [{ crId: 'D1' }],
  };
  const details = { FX: food('FX', 'Mystery', null), D1: food('D1', 'Kopi', 77, { category: 'Drink', defaultPortion: '1 regular cup(s) = 250ml' }) };
  for (let i = 0; i <= 25; i++) details[`F${i}`] = food(`F${i}`, i ? `Dish ${i}` : 'Steamed chicken rice', 100 + i);
  const asked = [];
  let failed = false;
  let limited = false;
  const fetch = async (url) => {
    const u = new URL(url);
    asked.push(u.pathname.replace(new URL(API).pathname, '') + u.search);
    const json = (data) => new Response(JSON.stringify(data).replace('Dish 3', 'Dish\u00093'), { headers: { 'Content-Type': 'application/json' } });
    if (u.pathname.endsWith('/foods/groups')) return json([{ id: 5, type: 'Food' }, { id: 6, type: 'Food' }, { id: 15, type: 'Drink' }, { id: 16, type: 'Drink' }]);
    if (u.pathname.includes('/foods/details/')) {
      const id = u.pathname.split('/').pop();
      if (id === 'F7' && !failed) { failed = true; return new Response('busy', { status: 503 }); }
      if (id === 'F9' && !limited) { limited = true; return new Response('slow down', { status: 429, headers: { 'Retry-After': '48' } }); }
      return json(details[id]);
    }
    const key = u.searchParams.get('type') ?? u.searchParams.get('foodGroupId');
    const page = Number(u.searchParams.get('pageNumber'));
    return json(list[key].slice((page - 1) * 25, page * 25).map((f) => ({ ...f, totalCount: list[key].length })));
  };
  return { fetch, asked };
}

const quick = { log: () => {}, paceMs: 0, scale: 0 };

test('crawl: every group a page at a time, drinks once, each food once, a failure tried again and "too many requests" waited out', async () => {
  const { fetch, asked } = site();
  const details = await crawl({ fetch, ...quick });
  assert.equal(details.length, 28);
  assert.deepEqual(asked.filter((a) => a.startsWith('/foods?')), ['/foods?foodGroupId=5&pageNumber=1', '/foods?foodGroupId=5&pageNumber=2', '/foods?foodGroupId=6&pageNumber=1', '/foods?type=Drink&pageNumber=1']);
  assert.equal(asked.filter((a) => a === '/foods/details/F7').length, 2);
  assert.equal(asked.filter((a) => a === '/foods/details/F9').length, 2);
  assert.equal(asked.filter((a) => a === '/foods/details/F0').length, 1);
});

test('crawl: foods already fetched aren\'t asked again, and progress is kept as it goes', async () => {
  const { fetch, asked } = site();
  const first = await crawl({ fetch, ...quick });
  asked.length = 0;
  let kept = null;
  const again = await crawl({ fetch, ...quick, have: first.slice(0, 20), kept: (sofar) => { kept = sofar.length; } });
  assert.equal(again.length, 28);
  assert.equal(asked.filter((a) => a.startsWith('/foods/details/')).length, 8);
  assert.equal(kept, 28);
});

test('import: foods without energy are left out, and the SQL writes the cache, updating on a second run', async () => {
  const { fetch } = site();
  const result = sgFoods(await crawl({ fetch, ...quick }));
  assert.equal(result.foods.length, 27);
  assert.deepEqual(result.skipped, ['Mystery']);
  assert.match(summary(result), /^SG FoodID: 27 foods to import\.\n1 left out with no energy: Mystery\n/);
  const db = fakeD1();
  await db.exec(sgSql(result.foods, 5));
  await db.exec(sgSql(result.foods, 6));
  const rows = db.raw.prepare("SELECT id, name, nameNorm, state, servings, fetchedAt FROM sourceFoods WHERE id IN ('sgfoodid:F0', 'sgfoodid:F3', 'sgfoodid:D1') ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: 'sgfoodid:D1', name: 'Kopi', nameNorm: 'kopi', state: 'asSold', servings: '[{"label":"1 regular cup","grams":250}]', fetchedAt: 6 },
    { id: 'sgfoodid:F0', name: 'Steamed chicken rice', nameNorm: 'steamed chicken rice', state: 'cooked', servings: '[{"label":"1 plate","grams":300}]', fetchedAt: 6 },
    { id: 'sgfoodid:F3', name: 'Dish 3', nameNorm: 'dish 3', state: 'asSold', servings: '[{"label":"1 plate","grams":300}]', fetchedAt: 6 },
  ]);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sourceFoods WHERE source = 'sgfoodid'").get().n, 27);
});
