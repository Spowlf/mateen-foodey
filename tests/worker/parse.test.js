import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, modelReply, seedCofid, food } from './helpers.js';
import { MODEL, DAILY_CALLS } from '../../worker/src/claude.js';

const item = (name, extra = {}) => ({ name, quantity: null, unit: null, grams: 100, gramsAssumed: false, state: 'unknown', searchTerm: name.toLowerCase(), ...extra });
const estimate = (name, kcal, assumptions = 'Assumed a typical recipe.') => ({ name, kcal, protein: 5, carbs: 20, fat: 3, fibre: null, sugars: 2, salt: 0.4, assumptions });

/** Sources with nothing in them, so only the cache and your foods can match. */
const EMPTY = {
  'search.openfoodfacts.org': () => Response.json({ hits: [] }),
  'api.nal.usda.gov': () => Response.json({ foods: [] }),
};

/** A model that parses into items and estimates whatever it's asked about. */
function model(items, estimates = {}) {
  return (body, step) => {
    if (step === 'parse') return { items };
    const asked = body.messages[0].content[0].text.split('\n').slice(1).filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\. /, '').split(',')[0]);
    return { items: asked.map((n) => estimates[n] ?? estimate(n, 150)) };
  };
}

test('parse: the request is Haiku 5.5 with a JSON schema at low effort, your 30 most-logged foods, and no sampling settings', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Porridge oats', { searchTerm: 'Porridge oats' })]) });
  const foods = Array.from({ length: 35 }, (_, i) => ({ ...food({ name: `Food ${String(i).padStart(2, '0')}`, sourceId: `x-${i}`, useCount: i }), id: `f${i}` }));
  foods.push({ ...food({ useCount: 99, usualGrams: 50 }), id: 'f-oats' });
  await w.call('POST', '/batch', { body: { foods } });
  const res = await w.call('POST', '/parse', { body: { text: 'my usual porridge' } });
  assert.equal(res.status, 200);
  const { body, headers } = w.modelCalls[0];
  assert.equal(body.model, MODEL);
  assert.equal(MODEL, 'claude-haiku-5-5');
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in body), k);
  assert.equal(headers['anthropic-version'], '2026-10-21');
  assert.equal(headers['x-api-key'], 'sk-test');
  const list = body.messages[0].content[0].text;
  assert.match(list, /^My own foods, most logged first:\n- Porridge oats \(usual 50 g\)\n- Food 34\n/);
  assert.equal(list.split('\n').length - 1, 30);
  assert.equal(body.messages[0].content[1].text, 'What I ate: my usual porridge');
  // "my usual porridge" resolves to your own food, with its id.
  assert.deepEqual([res.body.items[0].matchedFrom, res.body.items[0].food.id], ['foods', 'f-oats']);
  assert.equal(res.body.callsLeft, DAILY_CALLS - 1);
});

test('parse: no nutrition is taken from the parse step, unknown fields are dropped and grams are checked', async () => {
  const w = makeWorker({
    routes: EMPTY,
    model: model([
      { ...item('Egg', { grams: 6000 }), kcal: 900, nutrition: { kcal: 1 } },
      item('Toast', { grams: 0 }),
      item('Butter', { grams: 10.4 }),
    ]),
  });
  seedCofid(w, [{ code: '12-001', name: 'Egg, boiled', kcal: 147 }, { code: '11-001', name: 'Toast', kcal: 260 }, { code: '17-001', name: 'Butter', kcal: 744 }]);
  const res = await w.call('POST', '/parse', { body: { text: 'egg, toast, butter' } });
  const [egg, toast, butter] = res.body.items;
  assert.equal(egg.grams, null);
  assert.equal(toast.grams, null);
  assert.equal(butter.grams, 10);
  assert.ok(egg.kcal === null && !('nutrition' in egg));   // the sentence gave no kcal
  assert.equal(egg.food.per100g.kcalTenths, 1470);   // from CoFID, not the parse
  assert.equal(egg.state, null);                       // 'unknown' becomes null
  assert.equal(w.modelCalls.length, 1);                // everything matched: no estimate call
});

test('parse: only unmatched items are estimated, and the estimate says what it rests on', async () => {
  const w = makeWorker({
    routes: EMPTY,
    model: model([item('Eggs', { quantity: 2, grams: 120 }), item('Mystery stew', { gramsAssumed: true, grams: 350 })], {
      'Mystery stew': estimate('Mystery stew', 120, 'Assumed a beef and vegetable stew.'),
    }),
  });
  seedCofid(w, [{ code: '12-001', name: 'Eggs, chicken, whole, raw', kcal: 131 }]);
  const res = await w.call('POST', '/parse', { body: { text: 'two eggs and some mystery stew' } });
  assert.equal(w.modelCalls.length, 2);
  const asked = w.modelCalls[1].body.messages[0].content[0].text;
  assert.match(asked, /1\. Mystery stew, 350 g/);
  assert.ok(!asked.includes('Eggs, 120'));
  const [eggs, stew] = res.body.items;
  assert.deepEqual([eggs.matchedFrom, eggs.portionBasis], ['cofid', 'typed']);
  assert.deepEqual([stew.matchedFrom, stew.food.source, stew.portionBasis], ['estimate', 'estimate', 'guessed']);
  assert.equal(stew.food.assumptions, 'Assumed a beef and vegetable stew.');
  assert.equal(stew.food.per100g.kcalTenths, 1200);
  assert.equal(res.body.callsLeft, DAILY_CALLS - 2);
});

test('parse: a photo’s portions are guessed', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Toast')]) });
  seedCofid(w, [{ code: '11-001', name: 'Toast', kcal: 260 }]);
  const res = await w.call('POST', '/parse', { body: { image: { mediaType: 'image/jpeg', data: 'AAAA' } } });
  assert.equal(res.status, 200);
  assert.equal(res.body.items[0].portionBasis, 'guessed');
  const blocks = w.modelCalls[0].body.messages[0].content;
  assert.deepEqual(blocks[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
});

test('parse: a cooked item never matches a raw food', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Rice', { state: 'cooked', searchTerm: 'rice white' })]) });
  seedCofid(w, [{ code: '13-001', name: 'Rice, white, raw', kcal: 361, state: 'raw' }, { code: '13-002', name: 'Rice, white, boiled', kcal: 123, state: 'cooked' }]);
  const res = await w.call('POST', '/parse', { body: { text: '200 g cooked rice' } });
  assert.equal(res.body.items[0].food.name, 'Rice, white, boiled');
  assert.deepEqual(res.body.items[0].alternatives, []);
});

test('parse: a refusal, a failed call or bad text says nothing changed', async () => {
  const w = makeWorker({ routes: EMPTY, model: () => modelReply({}, { stop_reason: 'refusal', content: [] }) });
  const refused = await w.call('POST', '/parse', { body: { text: 'eggs' } });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, 'Nothing changed: that couldn’t be read as food. Search instead.');
  w.model = () => new Response('overloaded', { status: 529 });
  assert.equal((await w.call('POST', '/parse', { body: { text: 'eggs' } })).body.error, 'Nothing changed: sentence logging isn’t working right now. Search instead.');
  w.model = () => modelReply({}, { content: [{ type: 'text', text: '{"items": [' }] });
  assert.equal((await w.call('POST', '/parse', { body: { text: 'eggs' } })).status, 502);
  assert.equal((await w.call('POST', '/parse', { body: { text: '  ' } })).body.error, 'Nothing changed: type what you ate.');
  assert.equal((await w.call('POST', '/parse', { body: {} })).body.error, 'Nothing changed: type what you ate, or add a photo.');
  assert.equal((await w.call('POST', '/parse', { body: { image: { mediaType: 'image/gif', data: 'AAAA' } } })).status, 400);
});

test('parse: without the Anthropic key it says so and takes no call', async () => {
  const w = makeWorker({ env: { ANTHROPIC_API_KEY: '' } });
  const res = await w.call('POST', '/parse', { body: { text: 'eggs' } });
  assert.equal(res.status, 503);
  assert.equal(w.rows('parseCalls').length, 0);
});

test('cost guard: the 101st model call in a day is refused without calling the model', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Toast')]) });
  seedCofid(w, [{ code: '11-001', name: 'Toast', kcal: 260 }]);
  w.exec("INSERT INTO parseCalls (id, calls) VALUES ('2026-10-23', 99)");
  assert.equal((await w.call('POST', '/parse', { body: { text: 'toast' } })).status, 200);
  const res = await w.call('POST', '/parse', { body: { text: 'toast' } });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'Nothing changed: today’s limit for sentence logging is used up. Search instead.');
  assert.equal(w.modelCalls.length, 1);
  assert.equal(w.rows('parseCalls')[0].calls, 100);
});

test('cost guard: two calls at once at a count of 99 let exactly one through', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Toast')]) });
  seedCofid(w, [{ code: '11-001', name: 'Toast', kcal: 260 }]);
  w.exec("INSERT INTO parseCalls (id, calls) VALUES ('2026-10-23', 99)");
  const results = await Promise.all([1, 2].map(() => w.call('POST', '/parse', { body: { text: 'toast' } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
  assert.equal(w.modelCalls.length, 1);
});

test('cost guard: parse and estimate both count, and the day is the Worker’s UTC date', async () => {
  // 00:30 on the 24th in London is 23:30 UTC on the 23rd.
  const w = makeWorker({ now: Date.UTC(2026, 9, 23, 23, 30), routes: EMPTY, model: model([item('Mystery stew')]) });
  await w.call('POST', '/parse', { body: { text: 'mystery stew' } });
  assert.deepEqual(w.rows('parseCalls'), [{ id: '2026-10-23', calls: 2 }]);
  w.now = Date.UTC(2026, 9, 24, 0, 5);
  await w.call('POST', '/parse', { body: { text: 'mystery stew' } });
  // The new UTC day starts its own count.
  assert.deepEqual(w.rows('parseCalls', "id = '2026-10-24'"), [{ id: '2026-10-24', calls: 2 }]);
});

test('parse: an item with the kcal you gave keeps it and is never estimated', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Popeyes 2 piece', { kcal: 780 }), item('Mystery stew', { kcal: 300 })]) });
  const res = await w.call('POST', '/parse', { body: { text: 'Popeyes 2 piece 780 kcal, mystery stew' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => [i.name, i.kcal, i.matchedFrom]), [['Popeyes 2 piece', 780, null], ['Mystery stew', null, 'estimate']]);
  assert.equal(w.modelCalls.length, 2);
  assert.equal(w.modelCalls[1].body.messages[0].content[0].text.split('\nThey wrote')[0], 'Items:\n1. Mystery stew, 100 g');
});

test('cost guard: with the limit reached at the estimate step, matched items still come back', async () => {
  const w = makeWorker({ routes: EMPTY, model: model([item('Toast'), item('Mystery stew')]) });
  seedCofid(w, [{ code: '11-001', name: 'Toast', kcal: 260 }]);
  w.exec("INSERT INTO parseCalls (id, calls) VALUES ('2026-10-23', 99)");
  const res = await w.call('POST', '/parse', { body: { text: 'toast and mystery stew' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => i.matchedFrom), ['cofid', null]);
  assert.equal(res.body.callsLeft, 0);
});
