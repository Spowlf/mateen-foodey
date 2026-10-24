// A stand-in for Cloudflare D1 on Node's built-in SQLite, so the Worker runs in tests and on your Mac
// with no account or dependencies. Covers the part of the D1 API the Worker uses:
// prepare().bind().first/all/run, batch (one transaction), exec. queries counts the calls to it, as
// D1 does against its limit per request (50 on the Free plan): a batch is one.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = new URL('../worker/schema.sql', import.meta.url);

const plain = (row) => (row ? { ...row } : null);

/** file ':memory:' (the default) for tests, or a path to keep the data. */
export function sqliteD1(file = ':memory:', schemaSql = readFileSync(SCHEMA, 'utf8')) {
  const db = new DatabaseSync(file);
  db.exec(schemaSql);
  let queries = 0;

  const statement = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => statement(sql, values),
    async first(column) {
      queries += 1;
      const row = plain(db.prepare(sql).get(...params));
      if (!row) return null;
      return column ? row[column] : row;
    },
    async all() {
      queries += 1;
      return { success: true, results: db.prepare(sql).all(...params).map(plain), meta: {} };
    },
    async run() {
      queries += 1;
      const info = db.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(info.changes) } };
    },
  });

  return {
    raw: db,
    prepare: (sql) => statement(sql),
    get queries() { return queries; },
    async batch(statements) {
      queries += 1;
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => ({ success: true, results: db.prepare(s.sql).all(...s.params).map(plain), meta: {} }));
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql) {
      queries += 1;
      db.exec(sql);
    },
  };
}

export const fakeD1 = () => sqliteD1(':memory:');
