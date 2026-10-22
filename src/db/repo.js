// The app's data: the last-synced copy in memory (state) and in IndexedDB, and every change the
// screens may make. The backend is the source of truth: each change is sent first, and the rows it
// answers with are what gets stored. There's no outbox: saving needs a connection. Screens read
// state and change it only through this module.

import { SYNCED } from './schema.js';
import { createApi } from './api.js';
import { createDraftStore } from './drafts.js';
import { today, logLines } from '../engine/index.js';

const PARSE_TIMEOUT_MS = 60_000;

/**
 * db is the storage adapter: { readAll, putMany, clear, getMeta, setMeta, deleteMeta }
 * (IndexedDB in the app, see idb.js; a Map in tests).
 */
export function createRepo({ db, fetch, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const state = Object.fromEntries(SYNCED.map((name) => [name, []]));
  state.connection = null;
  state.rev = 0;
  state.lastSyncedAt = null;

  const api = createApi({ fetch, connection: () => state.connection });
  const listeners = new Set();
  let toldOn = null;   // the day listeners were last told, so a new day redraws "today" figures
  const changed = () => {
    toldOn = today(new Date(now()));
    for (const fn of listeners) fn();
  };

  /**
   * Stores rows the backend sent, in IndexedDB and in state, and returns how many. A row older
   * than the copy already here is skipped: a sync that set off before a save can answer after it.
   * { all } keeps every row (a full sync on connecting).
   */
  async function apply(changes = {}, { all = false } = {}) {
    let stored = 0;
    for (const [name, sent] of Object.entries(changes)) {
      if (!sent?.length || !state[name]) continue;
      const byId = new Map(state[name].map((r) => [r.id, r]));
      const rows = all ? sent : sent.filter((r) => !(r.rev < byId.get(r.id)?.rev));
      if (!rows.length) continue;
      await db.putMany(name, rows);
      for (const r of rows) byId.set(r.id, r);
      state[name] = [...byId.values()];
      stored += rows.length;
    }
    return stored;
  }

  async function applyWrite(result) {
    await apply(result.changes);
    changed();
    return result;
  }

  const repo = {
    state,
    api,
    draft: createDraftStore({ get: (k) => db.getMeta(k), set: (k, v) => db.setMeta(k, v), delete: (k) => db.deleteMeta(k) }),

    /** Calls fn whenever state changes (after a sync or a save). Returns a function to stop. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Reads the local copy in one go (one IndexedDB transaction, not one per table). */
    async load() {
      const { tables, meta } = await db.readAll(SYNCED, ['connection', 'rev', 'lastSyncedAt']);
      for (const name of SYNCED) state[name] = tables[name] ?? [];
      state.connection = meta.connection ?? null;
      state.rev = meta.rev ?? 0;
      state.lastSyncedAt = meta.lastSyncedAt ?? null;
    },

    connected: () => !!(state.connection?.apiBase && state.connection?.token),

    /**
     * Pulls everything changed since the last sync. Listeners are told only when rows arrived or
     * the day changed, so the sync on coming back to the app doesn't redraw an unchanged screen.
     */
    async sync() {
      const data = await api.get(`/sync?since=${state.rev}`);
      const stored = await apply(data.changes);
      state.rev = data.rev;
      state.lastSyncedAt = now();
      await db.setMeta('rev', state.rev);
      await db.setMeta('lastSyncedAt', state.lastSyncedAt);
      if (stored || toldOn !== today(new Date(now()))) changed();
      return data;
    },

    /**
     * Checks the address and token with a full sync before keeping them. A different backend
     * replaces the local copy. A failed check changes nothing.
     */
    async connect({ apiBase, token }) {
      const connection = { apiBase: apiBase.trim().replace(/\/+$/, ''), token: token.trim() };
      const data = await createApi({ fetch, connection: () => connection }).get('/sync?since=0');
      if (state.connection?.apiBase !== connection.apiBase) {
        await db.clear(SYNCED);
        for (const name of SYNCED) state[name] = [];
      }
      state.connection = connection;
      await db.setMeta('connection', connection);
      await apply(data.changes, { all: true });
      state.rev = data.rev;
      state.lastSyncedAt = now();
      await db.setMeta('rev', state.rev);
      await db.setMeta('lastSyncedAt', state.lastSyncedAt);
      changed();
    },

    /** Adds or changes one row: the fields sent replace the stored ones. */
    async saveRow(table, id, fields) {
      return applyWrite(await api.put(`/${table}/${encodeURIComponent(id)}`, fields));
    },

    /** Rows of several tables in one write, all or nothing: { foods?: [row], entries?: [row], ... }. */
    async saveBatch(changes) {
      return applyWrite(await api.post('/batch', changes));
    },

    async deleteRow(table, id) {
      return applyWrite(await api.del(`/${table}/${encodeURIComponent(id)}`));
    },

    /** Undo for a delete. */
    async restoreRow(table, id) {
      return applyWrite(await api.put(`/${table}/${encodeURIComponent(id)}`, { deletedAt: null }));
    },

    /**
     * Logs check sheet lines ({ food, grams, portionBasis }) on date in meal, with any new foods, in
     * one write. Returns the saved entries.
     */
    async logLines({ lines, date, meal, origin = 'manual' }) {
      const { foods, entries } = logLines({ lines, foods: state.foods, date, meal, origin, newId, now: now() });
      const result = await repo.saveBatch(foods.length ? { foods, entries } : { entries });
      return result.changes.entries ?? [];
    },

    /** Deletes several entries in one write (Undo after logging). */
    async deleteEntries(ids) {
      return repo.saveBatch({ entries: ids.map((id) => ({ id, deletedAt: now() })) });
    },

    /** A synced setting's value, or fallback when it isn't set. */
    setting(id, fallback = null) {
      const row = state.settings.find((s) => s.id === id && !s.deletedAt);
      return row ? row.value : fallback;
    },

    async setSetting(id, value) {
      return applyWrite(await api.put(`/settings/${encodeURIComponent(id)}`, { value }));
    },

    /** Source foods for a search (the Worker asks CoFID, Open Food Facts and USDA): { results, unavailable }. */
    search: (q) => api.get(`/search?q=${encodeURIComponent(q)}`),

    /** A packaged food by its barcode: { food } (null if not found). */
    barcode: (code) => api.get(`/barcode/${encodeURIComponent(code)}`),

    /** Sentence or photo logging, steps 1 to 3: { items, callsLeft }. */
    parse: (body) => api.post('/parse', body, { timeout: PARSE_TIMEOUT_MS }),
  };
  return repo;
}
