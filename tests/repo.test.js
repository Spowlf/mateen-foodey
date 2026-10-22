// The app's data layer against the real Worker (through fetch) and an in-memory stand-in for IndexedDB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo } from '../src/db/repo.js';
import { createApi } from '../src/db/api.js';
import { OfflineError, ApiError } from '../src/errors.js';
import { makeWorker, food, TOKEN, NOW } from './worker/helpers.js';

const BASE = 'https://api.example.com';

/** IndexedDB stand-in that survives "reloads": new repos over the same maps. */
function memoryDb(stores = new Map(), meta = new Map()) {
  const table = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  return {
    stores,
    meta,
    readAll: async (names, keys) => ({
      tables: Object.fromEntries(names.map((n) => [n, [...table(n).values()].map((r) => structuredClone(r))])),
      meta: Object.fromEntries(keys.map((k) => [k, structuredClone(meta.get(k))])),
    }),
    putMany: async (name, rows) => { for (const r of rows) table(name).set(r.id, structuredClone(r)); },
    clear: async (names) => { for (const n of names) table(n).clear(); },
    getMeta: async (key) => structuredClone(meta.get(key)),
    setMeta: async (key, value) => { meta.set(key, structuredClone(value)); },
    deleteMeta: async (key) => { meta.delete(key); },
  };
}

async function connected(w, db = memoryDb()) {
  let n = 0;
  const repo = createRepo({ db, fetch: w.fetch, now: () => w.now, newId: () => `id-${++n}` });
  await repo.load();
  await repo.connect({ apiBase: `${BASE}/`, token: TOKEN });
  return repo;
}

test('api: no connection set up asks you to connect, without calling anything', async () => {
  let called = false;
  const api = createApi({ fetch: async () => { called = true; }, connection: () => ({}) });
  await assert.rejects(api.get('/sync'), (err) => err instanceof ApiError && err.message === 'Connect to your backend in Settings.');
  assert.equal(called, false);
});

test('api: a network failure is "offline"; a refusal carries the server’s message', async () => {
  const offline = createApi({ fetch: async () => { throw new TypeError('Load failed'); }, connection: () => ({ apiBase: BASE, token: 't' }) });
  await assert.rejects(offline.get('/sync'), OfflineError);
  const w = makeWorker();
  const wrong = createApi({ fetch: w.fetch, connection: () => ({ apiBase: BASE, token: 'wrong' }) });
  await assert.rejects(wrong.get('/sync'), (err) => err instanceof ApiError && err.status === 401 && err.message === 'Check the backend token in Settings.');
});

test('repo: connecting syncs everything, and the copy opens again offline with when it was synced', async () => {
  const w = makeWorker();
  const db = memoryDb();
  const repo = await connected(w, db);
  assert.equal(repo.setting('floorKcal'), 1500);
  const reopened = createRepo({ db, fetch: async () => { throw new TypeError('offline'); } });
  await reopened.load();
  assert.equal(reopened.connected(), true);
  assert.equal(reopened.setting('weightUnit'), 'kg');
  assert.equal(reopened.state.lastSyncedAt, NOW);
  await assert.rejects(reopened.sync(), OfflineError);
});

test('repo: a wrong token changes nothing', async () => {
  const w = makeWorker();
  const repo = createRepo({ db: memoryDb(), fetch: w.fetch });
  await repo.load();
  await assert.rejects(repo.connect({ apiBase: BASE, token: 'nope' }), ApiError);
  assert.equal(repo.connected(), false);
});

test('repo: logging lines saves new foods and entries together, and Undo deletes the entries', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  const source = { ...food({ name: 'Toast', source: 'cofid', sourceId: '11-100', state: 'cooked' }) };
  const entries = await repo.logLines({
    lines: [{ food: source, grams: 40, portionBasis: 'typed' }, { food: source, grams: 30, portionBasis: 'guessed' }],
    date: '2026-10-23', meal: 'breakfast', origin: 'sentence',
  });
  assert.equal(entries.length, 2);
  assert.equal(w.rows('foods').length, 1);
  assert.equal(repo.state.foods[0].useCount, 2);
  assert.equal(repo.state.foods[0].usualGrams, 30);
  assert.equal(repo.state.entries.length, 2);
  await repo.deleteEntries(entries.map((e) => e.id));
  assert.ok(repo.state.entries.every((e) => e.deletedAt === NOW));
});

test('repo: offline, a save throws OfflineError and nothing is stored', async () => {
  const w = makeWorker();
  const db = memoryDb();
  await connected(w, db);
  const offline = createRepo({ db, fetch: async () => { throw new TypeError('Load failed'); } });
  await offline.load();
  await assert.rejects(offline.logLines({ lines: [{ food: food(), grams: 40 }], date: '2026-10-23', meal: 'lunch' }), OfflineError);
  assert.equal(offline.state.entries.length, 0);
  assert.equal(w.rows('entries').length, 0);
});

test('repo: listeners hear about a save, and a sync with nothing new stays quiet', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  let heard = 0;
  repo.subscribe(() => { heard += 1; });
  await repo.sync();
  assert.equal(heard, 0);
  await repo.saveRow('pots', 'p1', { name: 'Pan', grams: 900 });
  assert.equal(heard, 1);
});
