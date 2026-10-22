// Test harness for the Worker: a fresh D1 per test, a fixed clock, and fake food sources and model.

import { fakeD1 } from '../../scripts/sqlite-d1.js';
import { handle } from '../../worker/src/index.js';

export const TOKEN = 'test-token';
export const ORIGIN = 'https://spowlf.github.io';
// Friday 23 Oct 2026, 12:00 UTC.
export const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

/** A model reply carrying data as its JSON text. */
export const modelReply = (data, extra = {}) => Response.json({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(data) }], ...extra,
});

/** Which step a model request is: 'parse' or 'estimate', from its schema. */
export const stepOf = (body) => (body.output_config.format.schema.properties.items.items.required.includes('gramsAssumed') ? 'parse' : 'estimate');

/**
 * A Worker with its own empty database. routes answers other hosts: { 'host.name': (url, init) => Response },
 * every request to them recorded in w.calls as { url, init }. model(body, step) answers the Claude API
 * with data (or a Response), every request recorded in w.modelCalls.
 */
export function makeWorker({ now = NOW, env: extra = {}, routes = {}, model = null } = {}) {
  const env = { DB: fakeD1(), API_TOKEN: TOKEN, ALLOWED_ORIGIN: ORIGIN, ANTHROPIC_API_KEY: 'sk-test', USDA_API_KEY: 'usda-test', ...extra };
  const fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'api.anthropic.com') {
      const body = JSON.parse(init.body);
      w.modelCalls.push({ body, headers: init.headers });
      if (!w.model) throw new Error('no model in this test');
      const out = await w.model(body, stepOf(body));
      return out instanceof Response ? out : modelReply(out);
    }
    w.calls.push({ url: String(url), init });
    const answer = w.routes[u.hostname];
    if (!answer) return new Response('not found', { status: 404 });
    return answer(u, init);
  };
  const w = {
    env,
    now,
    routes,
    model,
    calls: [],
    modelCalls: [],
    deps: () => ({ now: w.now, fetch }),
    async request(method, path, { body, raw, token = TOKEN, origin = ORIGIN, headers = {} } = {}) {
      const h = new Headers(headers);
      if (token) h.set('Authorization', `Bearer ${token}`);
      if (origin) h.set('Origin', origin);
      if (body !== undefined || raw !== undefined) h.set('Content-Type', 'application/json');
      const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
      return handle(new Request(`https://api.example.com${path}`, { method, headers: h, body: payload }), env, w.deps());
    },
    /** Sends a request and returns { status, body } with the body parsed as JSON when it is JSON. */
    async call(method, path, options) {
      const res = await w.request(method, path, options);
      const type = res.headers.get('Content-Type') ?? '';
      const body = type.includes('json') ? await res.json() : await res.text();
      return { status: res.status, body, headers: res.headers };
    },
    /** A fetch that reaches this Worker, for testing the app's API client against it. */
    fetch: async (url, init) => handle(new Request(url, init), env, w.deps()),
    /** Rows straight from the database, skipping the API. */
    rows: (table, where = '1 = 1', ...params) => env.DB.raw.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all(...params).map((r) => ({ ...r })),
    /** Runs SQL straight on the database. */
    exec: (sql, ...params) => env.DB.raw.prepare(sql).run(...params),
  };
  return w;
}

const unknown = { kcalTenths: null, proteinMg: null, carbsMg: null, fatMg: null, fibreMg: null, sugarsMg: null, saltMg: null };

/** A food as the app sends it. */
export function food(extra = {}) {
  return {
    name: 'Porridge oats', brand: null, barcode: null, state: 'raw', source: 'cofid', sourceId: '11-001', assumptions: null,
    per100g: { ...unknown, kcalTenths: 3750, proteinMg: 11200, carbsMg: 60400, fatMg: 8000, fibreMg: 9000, sugarsMg: 0 },
    carbsIncludeFibre: 0, servings: [], gramsPer100ml: 100, fetchedAt: null, usualGrams: null, useCount: 0, lastUsedAt: null, userEdited: 0,
    ...extra,
  };
}

/** An entry as the app sends it: 50 g of food f-oats. */
export function entry(extra = {}) {
  return {
    date: '2026-10-23', meal: 'breakfast', foodId: 'f-oats', batchId: null, name: 'Porridge oats', grams: 50,
    nutrition: { kcalMilli: 187500, proteinUg: 5600000, carbsUg: 30200000, fatUg: 4000000, fibreUg: 4500000, sugarsUg: 0, saltUg: null, partial: [], carbsIncludeFibre: false },
    nutritionBasis: 'database', portionBasis: 'weighed', assumptions: null, status: 'logged', origin: 'manual', createdAt: NOW,
    ...extra,
  };
}

/** An Open Food Facts product. */
export function offProduct(code, name, kcal, extra = {}) {
  return {
    code, product_name: name, brands: 'Brand', serving_size: null,
    nutriments: { 'energy-kcal_100g': kcal, proteins_100g: 5, carbohydrates_100g: 20, fat_100g: 3, fiber_100g: 1, sugars_100g: 2, salt_100g: 0.5 },
    ...extra,
  };
}

/** A USDA search result. */
export function usdaFood(fdcId, description, kcal) {
  return {
    fdcId, description, dataType: 'SR Legacy',
    foodNutrients: [
      { nutrientNumber: '208', value: kcal }, { nutrientNumber: '203', value: 10 }, { nutrientNumber: '205', value: 30 },
      { nutrientNumber: '291', value: 4 }, { nutrientNumber: '204', value: 2 }, { nutrientNumber: '307', value: 400 },
    ],
  };
}

/** Puts CoFID foods straight into the cache, as the import script does. */
export function seedCofid(w, foods) {
  for (const f of foods) {
    w.exec(`INSERT INTO sourceFoods (id, source, sourceId, name, nameNorm, brand, barcode, state, per100g, carbsIncludeFibre, servings, fetchedAt)
      VALUES (?, 'cofid', ?, ?, ?, NULL, NULL, ?, ?, 0, '[]', 0)`,
    `cofid:${f.code}`, f.code, f.name, f.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), f.state ?? 'asSold', JSON.stringify({ ...unknown, kcalTenths: f.kcal * 10 }));
  }
}
