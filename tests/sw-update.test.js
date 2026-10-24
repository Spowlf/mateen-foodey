// The service worker's behaviour, run in node:vm with fake caches, clients and fetch:
// the app opens from cache, each open checks every file in the background (an unchanged one comes
// back empty, 304), a file that really changed is announced ("Updated, tap to reload") while an
// unchanged or new one is not, and new copies are stored only once every file was reached.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://spowlf.github.io';
const BASE = `${ORIGIN}/mateen-foodey/`;

/** A request as the worker sees it: a URL resolved against the app's folder, a mode, a cache mode. */
class FakeRequest {
  constructor(input, { method = 'GET', mode = 'no-cors', cache = 'default', headers = {} } = {}) {
    this.url = new URL(typeof input === 'string' ? input : input.url, BASE).href;
    Object.assign(this, { method, mode, cache, headers });
  }
}

/** A service worker global with an in-memory cache and a server whose files can be changed. */
function load(server = {}) {
  const listeners = {};
  const stores = new Map();
  const announced = [];
  const fetched = [];
  let online = true;
  const offline = new Set();   // files that can't be reached, though the server is
  const etag = (body) => `"${[...body].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}"`;
  const key = (req) => { const u = new URL(typeof req === 'string' ? req : req.url, BASE); u.search = ''; return u.href; };
  const self = {
    location: new URL(`${BASE}sw.js`),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [{ postMessage: (m) => announced.push(m) }],
    },
    async fetch(req) {
      const sentTag = req.headers?.['If-None-Match'] ?? null;
      const path = key(req).slice(BASE.length) || './';
      if (!online || offline.has(path)) { fetched.push({ url: key(req), cache: req.cache, status: 'failed' }); throw new TypeError('offline'); }
      if (!(path in server)) { fetched.push({ url: key(req), cache: req.cache, status: 404 }); return new Response('missing', { status: 404 }); }
      const tag = etag(server[path]);
      const status = sentTag === tag ? 304 : 200;
      fetched.push({ url: key(req), cache: req.cache, status });
      return new Response(status === 304 ? null : server[path], { status, headers: { ETag: tag } });
    },
    Request: FakeRequest, Response, URL, Uint8Array, Promise, console,
  };
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const files = stores.get(name);
    return {
      files,
      async match(req) { return files.get(key(req))?.clone(); },
      async put(req, res) { files.set(key(req), res.clone()); },
      async addAll(reqs) {
        for (const r of reqs) {
          const res = await self.fetch(r);
          if (!res.ok) throw new Error(`${r.url} ${res.status}`);
          files.set(key(r), res);
        }
      },
    };
  };
  self.caches = { open: async (name) => cacheFor(name), keys: async () => [...stores.keys()], delete: async (name) => stores.delete(name) };
  self.self = self;
  vm.runInNewContext(SOURCE, self);

  async function dispatch(type, extra = {}) {
    const waits = [];
    let response = null;
    listeners[type]({ ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => { response = p; } });
    const res = await response;
    await Promise.all(waits);
    return { res, handled: response !== null };
  }
  return {
    announced, fetched, stores, server,
    setOnline: (v) => { online = v; },
    unreachable: (path) => offline.add(path),
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    get: (path, mode = 'no-cors') => dispatch('fetch', { request: new FakeRequest(path, { mode }) }),
    check: (ports) => dispatch('message', { data: { type: 'check' }, ports }),
  };
}

const FILES = [...(/const FILES = \[([\s\S]*?)\];/.exec(SOURCE)[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]);

function serverWith(files, body = (f) => `v1 ${f}`) {
  return Object.fromEntries(files.map((f) => [f, body(f)]));
}

async function installed() {
  const sw = load(serverWith(FILES));
  await sw.install();
  await sw.activate();
  sw.fetched.length = 0;
  return sw;
}

test('install: every file is precached, skipping the browser\'s HTTP cache', async () => {
  const sw = load(serverWith(FILES));
  await sw.install();
  assert.equal([...sw.stores.values()][0].size, FILES.length);
  assert.ok(sw.fetched.every((f) => f.cache === 'reload'));
});

test('activate: old caches are dropped', async () => {
  const sw = await installed();
  sw.stores.set('mateen-foodey-v0', new Map());
  await sw.activate();
  assert.deepEqual([...sw.stores.keys()].filter((k) => k === 'mateen-foodey-v0'), []);
});

test('update: opening the app serves the cache now, stores a changed file and announces it once', async () => {
  const sw = await installed();
  sw.server['src/app.js'] = 'v2 src/app.js';
  const { res } = await sw.get('./', 'navigate');
  assert.equal(await res.text(), 'v1 ./');
  assert.equal(sw.announced.length, 1);
  assert.equal(sw.announced[0].type, 'updated');
  assert.equal(await (await sw.get('src/app.js')).res.text(), 'v2 src/app.js');
  await sw.get('./', 'navigate');
  assert.equal(sw.announced.length, 1);
});

test('update: opening the app asks the server for every file, never the browser\'s HTTP cache', async () => {
  const sw = await installed();
  await sw.get('./', 'navigate');
  assert.equal(sw.fetched.length, FILES.length);
  assert.ok(sw.fetched.every((f) => f.cache === 'no-cache'));
});

test('update: a cached module is served without asking the server', async () => {
  const sw = await installed();
  await sw.get('src/app.js');
  assert.deepEqual(sw.fetched, []);
});

test('update: an unchanged file comes back empty (304), not whole', async () => {
  const sw = await installed();
  await sw.check();
  assert.ok(sw.fetched.every((f) => f.status === 304));
  sw.fetched.length = 0;
  sw.server['styles.css'] = 'v2';
  await sw.check();
  assert.deepEqual(sw.fetched.filter((f) => f.status !== 304).map((f) => f.url.slice(BASE.length)), ['styles.css']);
});

test('update: a check that can\'t reach every file stores nothing, so old and new files never mix', async () => {
  const sw = await installed();
  sw.server['src/app.js'] = 'v2 src/app.js';
  sw.server['src/db/repo.js'] = 'v2 src/db/repo.js';
  sw.unreachable('src/db/repo.js');
  await sw.check();
  assert.deepEqual(sw.announced, []);
  assert.equal(await (await sw.get('src/app.js')).res.text(), 'v1 src/app.js');
});

test('check: the app returning to the screen refreshes every file and announces a change once', async () => {
  const sw = await installed();
  await sw.check();
  assert.equal(sw.fetched.length, FILES.length);
  assert.ok(sw.fetched.every((f) => f.cache === 'no-cache'));
  assert.deepEqual(sw.announced, []);
  sw.server['src/ui/history.js'] = 'v2';
  sw.server['styles.css'] = 'v2';
  await sw.check();
  assert.equal(sw.announced.length, 1);
  assert.equal(await (await sw.get('styles.css')).res.text(), 'v2');
});

test('check: asked from Settings, it answers on the port whether the files were reached', async () => {
  const sw = await installed();
  const replies = [];
  const port = { postMessage: (m) => replies.push(m) };
  sw.server['styles.css'] = 'v2';
  await sw.check([port]);
  sw.setOnline(false);
  await sw.check([port]);
  // Made in the worker's realm, so compared as plain data.
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [{ reached: true, changed: true }, { reached: false, changed: false }]);
});

test('check: offline, nothing is announced and the cache is kept', async () => {
  const sw = await installed();
  sw.setOnline(false);
  await sw.check();
  assert.deepEqual(sw.announced, []);
  assert.equal(await (await sw.get('src/app.js')).res.text(), 'v1 src/app.js');
});

test('update: an unchanged file is not announced', async () => {
  const sw = await installed();
  await sw.get('./', 'navigate');
  await sw.check();
  assert.deepEqual(sw.announced, []);
});

test('update: a file fetched for the first time is stored but not announced', async () => {
  const sw = await installed();
  sw.server['icons/new.png'] = 'png';
  const { res } = await sw.get('icons/new.png');
  assert.equal(await res.text(), 'png');
  assert.deepEqual(sw.announced, []);
  sw.setOnline(false);
  assert.equal(await (await sw.get('icons/new.png')).res.text(), 'png');
});

test('offline: the app opens from cache, query strings ignored', async () => {
  const sw = await installed();
  sw.setOnline(false);
  assert.equal(await (await sw.get('./')).res.text(), 'v1 ./');
  assert.equal(await (await sw.get('src/app.js?x=1')).res.text(), 'v1 src/app.js');
  assert.deepEqual(sw.announced, []);
});

test('offline: opening any page in the app falls back to the cached shell', async () => {
  const sw = await installed();
  sw.setOnline(false);
  assert.equal(await (await sw.get('settings', 'navigate')).res.text(), 'v1 index.html');
});

test('the API on another origin is never cached or answered here', async () => {
  const sw = await installed();
  const { handled } = await sw.get('https://mateen-foodey.example.workers.dev/sync?since=0');
  assert.equal(handled, false);
  assert.deepEqual(sw.fetched, []);
});
