import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, food, entry, NOW } from './helpers.js';
import { backupData, SYNCED } from '../../src/engine/index.js';

/** Every synced row and the rev, to check a refused restore changed nothing at all. */
const snapshot = (w) => ({ rev: w.rows('meta', "key = 'rev'")[0].value, ...Object.fromEntries(SYNCED.map((t) => [t, w.rows(t)])) });

async function withData(w) {
  await w.call('POST', '/batch', {
    body: {
      foods: [{ ...food(), id: 'f-oats' }],
      entries: [{ ...entry(), id: 'e-today' }],
      pots: [{ id: 'p1', name: 'Big pan', grams: 1200 }],
    },
  });
}

/** A backup holding another set of data, deleted rows too. */
function backup(extra = {}) {
  const tables = {
    foods: [{ ...food({ name: 'Bread', source: 'off', sourceId: '501', state: 'asSold' }), id: 'f-bread', updatedAt: 5, deletedAt: null },
      { ...food({ name: 'Gone', sourceId: '11-009' }), id: 'f-gone', updatedAt: 5, deletedAt: 9 }],
    entries: [{ ...entry({ foodId: 'f-gone', date: '2026-10-01' }), id: 'e-old', updatedAt: 6, deletedAt: null }],
    days: [{ id: '2026-10-01', state: 'complete', updatedAt: 7, deletedAt: null }],
    ...extra,
  };
  return backupData(tables, { now: NOW });
}

test('restore: replaces everything, deleted rows included, in one go', async () => {
  const w = makeWorker();
  await withData(w);
  const res = await w.call('POST', '/restore', { body: backup() });
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 4);
  const live = (t) => w.rows(t, 'deletedAt IS NULL').map((r) => r.id).sort();
  assert.deepEqual(live('foods'), ['f-bread']);
  assert.deepEqual(live('entries'), ['e-old']);   // its food is deleted, but still there
  assert.deepEqual(live('pots'), []);
  assert.deepEqual(live('days'), ['2026-10-01']);
  assert.ok(w.rows('foods', "id = 'f-gone'")[0].deletedAt);
  // The phone sees every change on its next sync.
  const sync = (await w.call('GET', '/sync?since=0')).body;
  assert.equal(sync.changes.pots[0].deletedAt > 0, true);
});

test('restore: a malformed, foreign, incomplete, duplicated or broken backup changes nothing', async () => {
  const w = makeWorker();
  await withData(w);
  const before = snapshot(w);
  const good = backup();
  const cases = [
    [{ raw: '{"app": "mateen-foodey", "tables": {' }, 'Nothing changed: send the details as JSON.'],
    [{ body: { app: 'mateen-money', version: 1, tables: {} } }, 'Nothing changed: this isn’t a Mateen Foodey backup.'],
    [{ body: backup({ days: [{ id: '2026-10-01', updatedAt: 7, deletedAt: null }] }) }, 'Nothing changed: this backup is missing some details.'],
    [{ body: backup({ days: [{ id: '2026-10-01', state: 'complete' }, { id: '2026-10-01', state: 'incomplete' }] }) }, 'Nothing changed: this backup has the same record twice.'],
    [{ body: { ...good, tables: { ...good.tables, entries: [{ ...entry({ foodId: 'f-nowhere' }), id: 'e-x' }] } } }, 'Nothing changed: an entry names a food that isn’t in the backup.'],
  ];
  for (const [options, message] of cases) {
    const res = await w.call('POST', '/restore', options);
    assert.equal(res.status, 400, message);
    assert.equal(res.body.error, message);
    assert.deepEqual(snapshot(w), before);
  }
});

test('restore: a failure partway through leaves the database exactly as it was', async () => {
  const w = makeWorker();
  await withData(w);
  const before = snapshot(w);
  // Passes the file check, but the database refuses the last entry's meal, after the other rows were written.
  const bad = backup({ entries: [{ ...entry({ foodId: 'f-bread' }), id: 'e1' }, { ...entry({ foodId: 'f-bread', meal: 'brunch' }), id: 'e2' }] });
  const res = await w.call('POST', '/restore', { body: bad });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /^Nothing changed: /);
  assert.deepEqual(snapshot(w), before);
});
