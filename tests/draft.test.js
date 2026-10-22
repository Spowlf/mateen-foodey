import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, submitDraft } from '../src/db/drafts.js';
import { emptyLogForm, isBlank } from '../src/engine/draft.js';
import { OfflineError, ApiError } from '../src/errors.js';

// A stand-in for IndexedDB that survives "reloads" (new store objects over the same map).
function memoryKv(map = new Map()) {
  return {
    map,
    get: async (k) => structuredClone(map.get(k)),
    set: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => { map.delete(k); },
  };
}

const filled = () => ({ ...emptyLogForm({ id: 'd-1', date: '2026-10-23', meal: 'breakfast' }), text: 'two eggs, toast with butter, flat white' });

test('offline draft: survives a refresh', async () => {
  const kv = memoryKv();
  await createDraftStore(kv).save(filled());
  const reopened = createDraftStore(memoryKv(kv.map));
  assert.deepEqual(await reopened.load(), filled());
});

test('offline draft: survives a failed save, offline or refused', async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const offline = await submitDraft({ form: filled(), store, send: async () => { throw new OfflineError(); } });
  assert.equal(offline.status, 'offline');
  const refused = await submitDraft({ form: filled(), store, send: async () => { throw new ApiError(500, 'Nothing changed: the server had a problem.'); } });
  assert.deepEqual(refused, { status: 'error', message: 'Nothing changed: the server had a problem.' });
  assert.deepEqual(await createDraftStore(memoryKv(kv.map)).load(), filled());
});

test('offline draft: never discarded by app logic, only once the backend confirms', async () => {
  const store = createDraftStore(memoryKv());
  const r = await submitDraft({ form: filled(), store, send: async (form) => { assert.deepEqual(await store.load(), filled()); return { id: form.id }; } });
  assert.deepEqual(r, { status: 'saved', result: { id: 'd-1' } });
  assert.equal(await store.load(), null);
});

test('offline draft: one at a time; clearing the form yourself removes it', async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  await store.save(filled());
  await store.save({ ...filled(), text: 'porridge' });
  assert.equal(kv.map.size, 1);
  assert.equal((await store.load()).text, 'porridge');
  await store.save(emptyLogForm({ date: '2026-10-23' }));
  assert.equal(await store.load(), null);
  assert.equal(isBlank({ ...emptyLogForm(), lines: [{ name: 'eggs' }] }), false);
});
