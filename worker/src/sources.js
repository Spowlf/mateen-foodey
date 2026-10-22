// Food search and barcode lookup: the source cache (CoFID's import and every food looked up), then
// Open Food Facts and USDA FoodData Central. Only the Worker calls them, never the phone.
//
// A search asked again within 7 days is answered from searchCache and sourceFoods without asking
// Open Food Facts or USDA. A barcode is looked up again after 30 days. A food fetched again
// refreshes your own copy of it, unless you've edited it (userEdited).

import { fromOff, fromUsda, normaliseName, nameWords, rankFoods, sourceKey } from '../../src/engine/index.js';
import { refuse } from './http.js';

const DAY_MS = 86_400_000;
export const SEARCH_FRESH_MS = 7 * DAY_MS;
export const BARCODE_FRESH_MS = 30 * DAY_MS;
const PER_SOURCE = 10;
const TIMEOUT_MS = 8000;

// Open Food Facts asks every app to name itself.
export const USER_AGENT = 'MateenFoodey/1.0 (https://github.com/spowlf/mateen-foodey)';
const OFF_FIELDS = 'code,product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments';
const USDA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];

/** A food from the cache, as the API sends it (no id: the phone gives it one when it's logged). */
function fromCache(row) {
  return {
    name: row.name, brand: row.brand, barcode: row.barcode, state: row.state, per100g: JSON.parse(row.per100g),
    carbsIncludeFibre: row.carbsIncludeFibre ? 1 : 0, servings: JSON.parse(row.servings), gramsPer100ml: 100,
    source: row.source, sourceId: row.sourceId, fetchedAt: row.fetchedAt, assumptions: null,
  };
}

/** A usable source food: it has a name, an id and energy. */
const usable = (f) => f.name && f.sourceId && f.per100g.kcalTenths != null;

export function cacheStatement(db, food, now) {
  return db.prepare(`INSERT INTO sourceFoods (id, source, sourceId, name, nameNorm, brand, barcode, state, per100g, carbsIncludeFibre, servings, fetchedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, nameNorm = excluded.nameNorm, brand = excluded.brand, barcode = excluded.barcode,
      state = excluded.state, per100g = excluded.per100g, carbsIncludeFibre = excluded.carbsIncludeFibre, servings = excluded.servings,
      fetchedAt = excluded.fetchedAt`)
    .bind(sourceKey(food), food.source, food.sourceId, food.name, normaliseName(`${food.name} ${food.brand ?? ''}`), food.brand, food.barcode,
      food.state, JSON.stringify(food.per100g), food.carbsIncludeFibre ? 1 : 0, JSON.stringify(food.servings ?? []), now);
}

async function cached(db, ids) {
  if (!ids.length) return [];
  const { results } = await db.prepare(`SELECT * FROM sourceFoods WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all();
  const byId = new Map(results.map((r) => [r.id, fromCache(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** The JSON at url, or throws. */
async function getJson(ctx, url, headers = {}) {
  const res = await ctx.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  return res.json();
}

/** Open Food Facts' search service, UK products only. query is normalised (letters, digits, spaces), so it can't break the query syntax. */
async function fetchOff(ctx, query) {
  const url = new URL('https://search.openfoodfacts.org/search');
  url.searchParams.set('q', `${query} countries_tags:"en:united-kingdom"`);
  url.searchParams.set('page_size', '20');
  url.searchParams.set('fields', OFF_FIELDS);
  const data = await getJson(ctx, url);
  return (data.hits ?? []).map(fromOff);
}

async function fetchUsda(ctx, env, query) {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', '20');
  url.searchParams.set('dataType', USDA_TYPES.join(','));
  const data = await getJson(ctx, url, { 'X-Api-Key': env.USDA_API_KEY });
  return (data.foods ?? []).map(fromUsda);
}

/**
 * Your own foods that came from these source foods, brought up to date with them. A food you've
 * edited is never touched. Returns the rows to write.
 */
async function refreshedOwn(store, fresh) {
  const keys = new Map(fresh.map((f) => [sourceKey(f), f]));
  if (!keys.size) return [];
  const own = await store.all('foods', `deletedAt IS NULL AND userEdited = 0 AND (source || ':' || sourceId) IN (${[...keys.keys()].map(() => '?').join(', ')})`, ...keys.keys());
  const out = [];
  for (const food of own) {
    const f = keys.get(sourceKey(food));
    const next = { name: f.name, brand: f.brand, barcode: f.barcode, per100g: f.per100g, carbsIncludeFibre: f.carbsIncludeFibre ? 1 : 0, servings: f.servings };
    const changed = Object.entries(next).some(([k, v]) => JSON.stringify(food[k]) !== JSON.stringify(v));
    if (changed) out.push({ ...food, ...next, fetchedAt: f.fetchedAt });
  }
  return out;
}

/** Saves fetched source foods to the cache (and refreshes your copies of them) in one write. */
async function keep(ctx, foods, extra = []) {
  const stamped = foods.map((f) => ({ ...f, carbsIncludeFibre: f.carbsIncludeFibre ? 1 : 0, fetchedAt: ctx.now }));
  const statements = [...stamped.map((f) => cacheStatement(ctx.store.db, f, ctx.now)), ...extra];
  const own = await refreshedOwn(ctx.store, stamped);
  await ctx.store.write(own.length ? { foods: own } : {}, ctx.now, { extra: statements });
  return stamped;
}

/** One source's foods for a normalised query: from searchCache when fresh, else fetched and cached. */
async function searchSource(ctx, env, source, queryNorm) {
  const db = ctx.store.db;
  const id = `${source}:${queryNorm}`;
  const hit = await db.prepare('SELECT * FROM searchCache WHERE id = ?').bind(id).first();
  if (hit && ctx.now - hit.fetchedAt < SEARCH_FRESH_MS) return cached(db, JSON.parse(hit.sourceFoodIds));

  const fetched = (source === 'off' ? await fetchOff(ctx, queryNorm) : await fetchUsda(ctx, env, queryNorm)).filter(usable);
  const unique = [...new Map(fetched.map((f) => [sourceKey(f), f])).values()];
  const remember = db.prepare(`INSERT INTO searchCache (id, source, queryNorm, sourceFoodIds, fetchedAt) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET sourceFoodIds = excluded.sourceFoodIds, fetchedAt = excluded.fetchedAt`)
    .bind(id, source, queryNorm, JSON.stringify(unique.map(sourceKey)), ctx.now);
  return keep(ctx, unique, [remember]);
}

/** CoFID foods (imported once) whose names hold every word. */
async function searchCofid(db, query) {
  const words = nameWords(query);
  if (!words.length) return [];
  const { results } = await db.prepare(`SELECT * FROM sourceFoods WHERE source = 'cofid' AND ${words.map(() => 'nameNorm LIKE ?').join(' AND ')} LIMIT 200`)
    .bind(...words.map((w) => `%${w}%`)).all();
  return results.map(fromCache);
}

/** Every cached source food whose name holds every word (for matching parsed items). */
export async function searchCached(db, query) {
  const words = nameWords(query);
  if (!words.length) return [];
  const { results } = await db.prepare(`SELECT * FROM sourceFoods WHERE ${words.map(() => 'nameNorm LIKE ?').join(' AND ')} LIMIT 200`)
    .bind(...words.map((w) => `%${w}%`)).all();
  return results.map(fromCache);
}

/** Which sources are on: the sources setting, and USDA only with its key. */
export const sourcesOn = (settings, env) => ({
  cofid: settings.sources?.cofid !== false,
  off: settings.sources?.off !== false,
  usda: settings.sources?.usda !== false && !!env.USDA_API_KEY,
});

/**
 * GET /search?q=: CoFID, then Open Food Facts, then USDA, each best first and only foods whose
 * names hold every word. A source that can't be reached is left out and named in unavailable.
 * Returns { results: [Food], unavailable: ['off' | 'usda'] }.
 */
export async function searchFoods(ctx, env, query, settings, { state = null } = {}) {
  const queryNorm = normaliseName(query);
  if (!queryNorm) return { results: [], unavailable: [] };
  const on = sourcesOn(settings, env);
  const unavailable = [];
  const live = async (source) => {
    if (!on[source]) return [];
    try { return await searchSource(ctx, env, source, queryNorm); } catch { unavailable.push(source); return []; }
  };
  const [cofid, off, usda] = await Promise.all([on.cofid ? searchCofid(ctx.store.db, queryNorm) : [], live('off'), live('usda')]);
  const results = [cofid, off, usda].flatMap((list) => rankFoods(queryNorm, list, { state }).slice(0, PER_SOURCE));
  return { results, unavailable: unavailable.sort() };
}

/** A barcode: 8 to 14 digits. */
export const validBarcode = (code) => /^\d{8,14}$/.test(code);

/**
 * GET /barcode/:code: the cached food, else Open Food Facts. A cached food older than 30 days is
 * fetched again, and kept if Open Food Facts can't be reached. Returns { food } (null if not found).
 */
export async function lookupBarcode(ctx, code) {
  const db = ctx.store.db;
  const row = await db.prepare("SELECT * FROM sourceFoods WHERE source = 'off' AND (sourceId = ? OR barcode = ?) ORDER BY fetchedAt DESC LIMIT 1").bind(code, code).first();
  if (row && ctx.now - row.fetchedAt < BARCODE_FRESH_MS) return { food: fromCache(row) };
  let data;
  try {
    data = await getJson(ctx, `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  } catch {
    if (row) return { food: fromCache(row) };
    throw refuse('Open Food Facts can’t be reached. Try again, or search by name.', 502);
  }
  const food = data?.status === 1 && data.product ? fromOff({ code, ...data.product }) : null;
  if (!food || !usable(food)) return { food: row ? fromCache(row) : null };
  const [kept] = await keep(ctx, [food]);
  return { food: kept };
}
