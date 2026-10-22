import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../../scripts/sqlite-d1.js';
import { TABLES, SYNCED } from '../../src/engine/tables.js';
import { STORES } from '../../src/db/schema.js';
import { readFileSync } from 'node:fs';

const columnsOf = (db, table) => db.raw.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);

test('schema: every synced table exists with exactly the columns in tables.js', () => {
  const db = fakeD1();
  for (const [name, { columns }] of Object.entries(TABLES)) {
    assert.deepEqual(columnsOf(db, name).sort(), [...columns].sort(), name);
  }
  for (const name of SYNCED) assert.ok(STORES[name], `IndexedDB has ${name}`);
});

test('schema: the Worker-only tables exist and are not synced', () => {
  const db = fakeD1();
  for (const name of ['meta', 'sourceFoods', 'searchCache', 'parseCalls']) {
    assert.ok(columnsOf(db, name).length, name);
    assert.ok(!SYNCED.includes(name), name);
  }
});

test('schema: one live food per source food, but a deleted one frees it', () => {
  const db = fakeD1();
  const insert = (id, deletedAt = null) => db.raw.prepare(`INSERT INTO foods (id, name, state, per100g, source, sourceId, updatedAt, deletedAt, rev)
    VALUES (?, 'Oats', 'raw', '{}', 'cofid', '11-001', 0, ?, 1)`).run(id, deletedAt);
  insert('a', 5);
  insert('b');
  assert.throws(() => insert('c'), /UNIQUE/);
});

test('schema: running it again changes nothing', async () => {
  const db = fakeD1();
  db.raw.prepare("UPDATE meta SET value = 7 WHERE key = 'rev'").run();
  await db.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
  assert.equal(db.raw.prepare("SELECT value FROM meta WHERE key = 'rev'").get().value, 7);
});
