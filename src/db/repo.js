// The app's data: the last-synced copy in memory (state) and in IndexedDB, and every change the
// screens may make. The backend is the source of truth: each change is sent first, and the rows it
// answers with are what gets stored. There's no outbox: saving needs a connection. Screens read
// state and change it only through this module.

import { SYNCED } from './schema.js';
import { createApi, normaliseApiBase } from './api.js';
import { ApiError } from '../errors.js';
import { createDraftStore } from './drafts.js';
import { today, logLines, adoptFoods, copyEntries } from '../engine/index.js';

const PARSE_TIMEOUT_MS = 60_000;

/**
 * db is the storage adapter: { readAll, putMany, clear, getMeta, setMeta, deleteMeta }
 * (IndexedDB in the app, see idb.js; a Map in tests).
 */
export function createRepo({ db, fetch, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const state = Object.fromEntries(SYNCED.map((name) => [name, []]));
  state.connection = null;
  // What's typed into Settings before connecting, kept on this phone so a reload (iOS often reloads
  // a home screen app you switched away from to copy the token) doesn't empty the form.
  state.connectionDraft = null;
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
      const { tables, meta } = await db.readAll(SYNCED, ['connection', 'connectionDraft', 'rev', 'lastSyncedAt']);
      for (const name of SYNCED) state[name] = tables[name] ?? [];
      state.connection = meta.connection ?? null;
      state.connectionDraft = meta.connectionDraft ?? null;
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
      const connection = { apiBase: normaliseApiBase(apiBase), token: String(token ?? '').trim() };
      if (!connection.apiBase) throw new ApiError(0, 'Nothing changed: enter the backend address.');
      if (!connection.token) throw new ApiError(0, 'Nothing changed: enter the token.');
      const data = await createApi({ fetch, connection: () => connection }).get('/sync?since=0');
      if (state.connection?.apiBase !== connection.apiBase) {
        await db.clear(SYNCED);
        for (const name of SYNCED) state[name] = [];
      }
      state.connection = connection;
      await db.setMeta('connection', connection);
      state.connectionDraft = null;
      await db.deleteMeta('connectionDraft');
      await apply(data.changes, { all: true });
      state.rev = data.rev;
      state.lastSyncedAt = now();
      await db.setMeta('rev', state.rev);
      await db.setMeta('lastSyncedAt', state.lastSyncedAt);
      changed();
    },

    /** Keeps what's typed into Settings' backend fields until it connects. */
    async saveConnectionDraft(draft) {
      state.connectionDraft = draft;
      await db.setMeta('connectionDraft', draft);
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
     * one write. savedMealId marks a saved meal's entries. Returns the saved entries.
     */
    async logLines({ lines, date, meal, origin = 'manual', savedMealId = null }) {
      const { foods, entries } = logLines({ lines, foods: state.foods, date, meal, origin, newId, now: now(), savedMealId });
      const result = await repo.saveBatch(foods.length ? { foods, entries } : { entries });
      return result.changes.entries ?? [];
    },

    /**
     * Saves a row whose lines name foods (a saved meal's items, a recipe's or batch's ingredients):
     * build(lines) gets the lines with every food one of yours and returns the row; any new foods go
     * in the same write.
     */
    async saveWithFoods(table, lines, build) {
      const adopted = adoptFoods({ lines, foods: state.foods, newId });
      const row = build(adopted.lines);
      return repo.saveBatch(adopted.foods.length ? { foods: adopted.foods, [table]: [row] } : { [table]: [row] });
    },

    /** Deletes several entries in one write (Undo after logging). */
    async deleteEntries(ids) {
      return repo.saveBatch({ entries: ids.map((id) => ({ id, deletedAt: now() })) });
    },

    /** Copies entries to date (Copy to Today) in one write. Returns the copies saved. */
    async copyEntries(list, date) {
      const copies = copyEntries(list, { date, newId, now: now() });
      const result = await repo.saveBatch({ entries: copies });
      return result.changes.entries ?? [];
    },

    /**
     * Replaces everything on the backend with a backup (checked there before anything is written),
     * then pulls the result: rows the backup doesn't have arrive deleted.
     */
    async restoreBackup(data) {
      const result = await api.post('/restore', data, { timeout: PARSE_TIMEOUT_MS });
      await repo.sync();
      return result;
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

    /** An estimate for one item, in place of its match ({ name, grams, state }): { food, callsLeft }. */
    estimate: (body) => api.post('/estimate', body, { timeout: PARSE_TIMEOUT_MS }),
  };
  return repo;
}
