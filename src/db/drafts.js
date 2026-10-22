// The one offline draft on the Log screen, labelled "Not synced".
// It's written on every edit, not only when a save fails, so closing the app never loses it.
// It's cleared only after the backend confirms the save: no app logic or failed request discards it.

import { isBlank } from '../engine/draft.js';
import { OfflineError } from '../errors.js';

const KEY = 'draft';

/** kv is { get(key), set(key, value), delete(key) }, all async (IndexedDB in the app, a Map in tests). */
export function createDraftStore(kv) {
  return {
    async load() {
      const row = await kv.get(KEY);
      return row?.form ?? null;
    },
    /** Keeps the form. Only clearing the form yourself (a blank form) removes it. */
    async save(form, now = Date.now()) {
      if (isBlank(form)) await kv.delete(KEY);
      else await kv.set(KEY, { form, savedAt: now });
    },
    async clear() {
      await kv.delete(KEY);
    },
  };
}

/**
 * Tries to save the form. send(form) resolves once the backend has it, or throws.
 * Returns { status: 'saved', result } | { status: 'offline' } | { status: 'error', message }.
 * The draft is kept unless the save succeeded.
 */
export async function submitDraft({ form, store, send, now = Date.now() }) {
  await store.save(form, now);
  try {
    const result = await send(form);
    await store.clear();
    return { status: 'saved', result };
  } catch (err) {
    if (err instanceof OfflineError) return { status: 'offline' };
    return { status: 'error', message: err.message };
  }
}
