import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, ORIGIN } from './helpers.js';

// Every route the Worker answers, with a body where it takes one.
const ROUTES = [
  ['GET', '/sync?since=0'], ['PUT', '/foods/f1', {}], ['DELETE', '/foods/f1'], ['POST', '/batch', {}],
  ['GET', '/search?q=egg'], ['GET', '/barcode/5010029000016'], ['POST', '/parse', { text: 'egg' }],
  ['POST', '/health', { date: '2026-10-23' }],
  ['GET', '/summary?date=2026-10-26'], ['POST', '/summary', { timestamp: '2026-10-26T07:00:00+00:00' }], ['POST', '/restore', {}],
  ['GET', '/nothing'],
];

test('auth: no route answers without a valid token, and nothing is written', async () => {
  const w = makeWorker({ model: () => { throw new Error('the model must not be called'); } });
  for (const [method, path, body] of ROUTES) {
    for (const token of [null, 'wrong-token', 'test-toke']) {
      const res = await w.call(method, path, { token, body });
      assert.equal(res.status, 401, `${method} ${path}`);
      const message = typeof res.body === 'string' ? res.body : res.body.error;
      assert.equal(message, 'Check the backend token in Settings.');
    }
  }
  assert.equal(w.calls.length + w.modelCalls.length, 0);
  assert.equal(w.rows('settings').length, 0);   // not even the seed
  assert.equal(w.rows('parseCalls').length, 0);
});

test('auth: a Worker with no token set refuses everything', async () => {
  const w = makeWorker({ env: { API_TOKEN: '' } });
  assert.equal((await w.call('GET', '/sync', { token: '' })).status, 401);
  assert.equal((await w.call('GET', '/sync', { token: 'anything' })).status, 401);
});

test('CORS: the Pages origin may call the API, other origins get no CORS headers', async () => {
  const w = makeWorker();
  const ok = await w.request('OPTIONS', '/entries/x', { token: null, headers: { 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.match(ok.headers.get('Access-Control-Allow-Methods'), /PUT/);

  const other = await w.request('OPTIONS', '/entries/x', { token: null, origin: 'https://evil.example' });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await w.request('GET', '/sync')).headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('routes: an unknown path or table is 404, and tables only the Worker writes are refused', async () => {
  const w = makeWorker();
  assert.equal((await w.call('GET', '/nothing')).status, 404);
  assert.equal((await w.call('PUT', '/meta/rev', { body: { value: 0 } })).status, 404);
  assert.equal((await w.call('PUT', '/sourceFoods/x', { body: {} })).status, 404);
  assert.equal((await w.call('PUT', '/activity/2026-10-23', { body: { date: '2026-10-23' } })).status, 404);
  assert.equal((await w.call('POST', '/batch', { body: { activity: [{ id: '2026-10-23', date: '2026-10-23' }] } })).status, 404);
  assert.equal((await w.call('PUT', '/entries/%E0%A4%A', { body: {} })).status, 404);
});

test('routes: a body that is not JSON is refused with nothing changed', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/pots/p1', { raw: '{"name":' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /^Nothing changed: /);
  assert.equal(w.rows('pots').length, 0);
});

test('text routes answer errors as plain text, for a notification', async () => {
  const w = makeWorker();
  const res = await w.call('POST', '/health', { body: { date: 'yesterday' } });
  assert.equal(res.status, 400);
  assert.equal(res.body, 'Nothing changed: send the date from the phone.');
});
