import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, offProduct, usdaFood, seedCofid, food, NOW } from './helpers.js';
import { USER_AGENT } from '../../worker/src/sources.js';

const DAY = 86_400_000;

/** Open Food Facts and USDA answering searches from fixed lists. */
function sources({ off = [], usda = [], product = null } = {}) {
  return {
    'world.openfoodfacts.org': () => (product ? Response.json({ status: 1, product }) : Response.json({ status: 0 })),
    'search.openfoodfacts.org': () => Response.json({ hits: off }),
    'api.nal.usda.gov': () => Response.json({ foods: usda }),
  };
}

test('search: CoFID first, then Open Food Facts, then USDA, only foods with every word', async () => {
  const w = makeWorker({
    routes: sources({
      off: [offProduct('5000000000001', 'Free range eggs', 140), offProduct('5000000000002', 'Egg custard tart', 280), offProduct('5000000000003', 'Bacon', 300)],
      usda: [usdaFood(171287, 'Egg, whole, raw, fresh', 143)],
    }),
  });
  seedCofid(w, [{ code: '12-001', name: 'Eggs, chicken, whole, raw', kcal: 131, state: 'raw' }, { code: '12-002', name: 'Bread, white', kcal: 233 }]);
  const res = await w.call('GET', '/search?q=Eggs');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results.map((f) => [f.source, f.name]), [
    ['cofid', 'Eggs, chicken, whole, raw'], ['off', 'Free range eggs'], ['off', 'Egg custard tart'], ['usda', 'Egg, whole, raw, fresh'],
  ]);
  assert.deepEqual(res.body.unavailable, []);
  const usda = res.body.results.at(-1);
  assert.equal(usda.per100g.carbsMg, 26000);   // 30 g less 4 g fibre
  assert.equal(usda.per100g.saltMg, 1000);     // 400 mg sodium × 2.5
  assert.equal(usda.id, undefined);            // the phone gives it an id when it's logged
});

test('search: SG FoodID comes after CoFID and before Open Food Facts, and can be turned off', async () => {
  const w = makeWorker({ routes: sources({ off: [offProduct('5000000000001', 'Free range eggs', 140)] }) });
  seedCofid(w, [{ code: '12-001', name: 'Eggs, chicken, whole, raw', kcal: 131, state: 'raw' }]);
  seedCofid(w, [{ code: 'F01050005', name: 'Fried egg', kcal: 234, state: 'cooked' }, { code: 'D09010035', name: 'Kopi', kcal: 77 }], 'sgfoodid');
  const res = await w.call('GET', '/search?q=egg');
  assert.deepEqual(res.body.results.map((f) => [f.source, f.name]), [['cofid', 'Eggs, chicken, whole, raw'], ['sgfoodid', 'Fried egg'], ['off', 'Free range eggs']]);
  // A sources setting saved before SG FoodID leaves it on; turned off, it's left out.
  await w.call('PUT', '/settings/sources', { body: { value: { off: true, cofid: true, usda: true } } });
  assert.ok((await w.call('GET', '/search?q=egg')).body.results.some((f) => f.source === 'sgfoodid'));
  await w.call('PUT', '/settings/sources', { body: { value: { off: true, cofid: true, sgfoodid: false, usda: true } } });
  assert.ok(!(await w.call('GET', '/search?q=egg')).body.results.some((f) => f.source === 'sgfoodid'));
});

test('search: sources get an identifying User-Agent, and the USDA key goes in a header, not the address', async () => {
  const w = makeWorker({ routes: sources() });
  await w.call('GET', '/search?q=eggs');
  const off = w.calls.find((c) => c.url.includes('openfoodfacts'));
  assert.match(new URL(off.url).searchParams.get('q'), /^eggs countries_tags:"en:united-kingdom"$/);
  const usda = w.calls.find((c) => c.url.includes('nal.usda.gov'));
  assert.equal(off.init.headers['User-Agent'], USER_AGENT);
  assert.equal(usda.init.headers['X-Api-Key'], 'usda-test');
  assert.ok(!usda.url.includes('usda-test'));
});

test('search: a query asked again within 7 days asks neither source', async () => {
  const w = makeWorker({ routes: sources({ off: [offProduct('5000000000001', 'Free range eggs', 140)], usda: [usdaFood(1, 'Egg, whole', 143)] }) });
  const first = await w.call('GET', '/search?q=eggs');
  assert.equal(w.calls.length, 2);
  w.now = NOW + 6 * DAY;
  const again = await w.call('GET', '/search?q=%20EGGS%20');
  assert.equal(w.calls.length, 2);
  assert.deepEqual(again.body.results.map((f) => f.name), first.body.results.map((f) => f.name));
  w.now = NOW + 8 * DAY;
  await w.call('GET', '/search?q=eggs');
  assert.equal(w.calls.length, 4);
  assert.equal(w.rows('sourceFoods').length, 2);
});

test('search: a source that can’t be reached is left out and named, and nothing is cached for it', async () => {
  const w = makeWorker({ routes: { 'search.openfoodfacts.org': () => new Response('busy', { status: 503 }), 'api.nal.usda.gov': () => Response.json({ foods: [usdaFood(1, 'Egg, whole', 143)] }) } });
  const res = await w.call('GET', '/search?q=eggs');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.unavailable, ['off']);
  assert.deepEqual(res.body.results.map((f) => f.source), ['usda']);
  assert.equal(w.rows('searchCache', "source = 'off'").length, 0);
});

test('search: sources turned off in Settings, or USDA without its key, aren’t asked', async () => {
  const w = makeWorker({ routes: sources(), env: { USDA_API_KEY: '' } });
  await w.call('PUT', '/settings/sources', { body: { value: { off: false, cofid: true, usda: true } } });
  await w.call('GET', '/search?q=eggs');
  assert.equal(w.calls.length, 0);
});

test('barcode: looked up on Open Food Facts once, then from the cache for 30 days', async () => {
  const w = makeWorker({ routes: sources({ product: offProduct('5010029000016', 'Soft White Medium', 233, { serving_size: '1 slice (40 g)', serving_quantity: 40 }) }) });
  const res = await w.call('GET', '/barcode/5010029000016');
  assert.equal(res.status, 200);
  assert.equal(res.body.food.name, 'Soft White Medium');
  assert.equal(res.body.food.per100g.kcalTenths, 2330);
  assert.deepEqual(res.body.food.servings, [{ label: '1 slice (40 g)', grams: 40 }]);
  w.now = NOW + 29 * DAY;
  await w.call('GET', '/barcode/5010029000016');
  assert.equal(w.calls.length, 1);
  w.now = NOW + 31 * DAY;
  w.routes['world.openfoodfacts.org'] = () => new Response('down', { status: 500 });
  const stale = await w.call('GET', '/barcode/5010029000016');
  assert.equal(stale.body.food.name, 'Soft White Medium');   // kept when the source can't be reached
});

test('barcode: unknown is null, a bad code is refused, and no connection says nothing changed', async () => {
  const w = makeWorker({ routes: sources() });
  assert.deepEqual((await w.call('GET', '/barcode/5000000000009')).body, { food: null });
  assert.equal((await w.call('GET', '/barcode/12ab')).body.error, 'Nothing changed: enter the 8 to 14 digits under the barcode.');
  w.routes['world.openfoodfacts.org'] = () => new Response('down', { status: 500 });
  const res = await w.call('GET', '/barcode/5000000000008');
  assert.equal(res.status, 502);
  assert.match(res.body.error, /^Nothing changed: Open Food Facts can’t be reached/);
});

test('refresh: fetching a source food again updates your copy, never one you edited', async () => {
  const w = makeWorker({ routes: sources({ product: offProduct('5010029000016', 'Soft White Medium', 240) }) });
  const base = { source: 'off', sourceId: '5010029000016', name: 'Old name', state: 'asSold', per100g: food().per100g };
  await w.call('PUT', '/foods/mine', { body: food(base) });
  await w.call('GET', '/barcode/5010029000016');
  const mine = w.rows('foods', 'id = ?', 'mine')[0];
  assert.equal(mine.name, 'Soft White Medium');
  assert.equal(JSON.parse(mine.per100g).kcalTenths, 2400);
  assert.equal(mine.fetchedAt, NOW);

  await w.call('PUT', '/foods/mine', { body: { name: 'My bread', userEdited: 1 } });
  w.now = NOW + 31 * DAY;
  w.routes['world.openfoodfacts.org'] = sources({ product: offProduct('5010029000016', 'Soft White Medium', 250) })['world.openfoodfacts.org'];
  await w.call('GET', '/barcode/5010029000016');
  const edited = w.rows('foods', 'id = ?', 'mine')[0];
  assert.equal(edited.name, 'My bread');
  assert.equal(JSON.parse(edited.per100g).kcalTenths, 2400);
});
