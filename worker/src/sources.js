// Food search and barcode lookup: the source cache (CoFID's and SG FoodID's imports and every food
// looked up), then Open Food Facts and USDA FoodData Central. Only the Worker calls them, never the phone.
//
// A search asked again within 7 days is answered from searchCache and sourceFoods without asking
// Open Food Facts or USDA. A barcode is looked up again after 30 days. A food fetched again
// refreshes your own copy of it, unless you've edited it (userEdited).
// Several searches at once (sentence logging's items) take the same few calls to D1 as one, since
// the Free plan allows 50 a request: their reads go together in one batch.

import { fromOff, fromUsda, normaliseName, nameWords, rankFoods, sourceKey } from '../../src/engine/index.js';
import { refuse } from './http.js';
import { fromDb, chunks, marks } from './store.js';

const DAY_MS = 86_400_000;
export const SEARCH_FRESH_MS = 7 * DAY_MS;
export const BARCODE_FRESH_MS = 30 * DAY_MS;
const PER_SOURCE = 10;
const TIMEOUT_MS = 8000;

// Open Food Facts asks every app to name itself.
export const USER_AGENT = 'MateenFoodey/1.0 (https://github.com/spowlf/mateen-foodey)';
const OFF_FIELDS = 'code,product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments';
const USDA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];
// Sources imported whole into the cache, in the order their foods are shown, before the ones asked live.
const IMPORTED = ['cofid', 'sgfoodid'];

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

/** Cached source foods by id, in their order, in one call. */
async function cached(db, ids) {
  if (!ids.length) return [];
  const out = await db.batch(chunks([...new Set(ids)]).map((part) => db.prepare(`SELECT * FROM sourceFoods WHERE id IN (${marks(part)})`).bind(...part)));
  const byId = new Map(out.flatMap((r) => r.results).map((r) => [r.id, fromCache(r)]));
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
 * Your own foods that came from these source foods, brought up to date with them, in one call. A
 * food you've edited is never touched. Returns the rows to write.
 */
async function refreshedOwn(store, fresh) {
  const keys = new Map(fresh.map((f) => [sourceKey(f), f]));
  if (!keys.size) return [];
  const out = await store.db.batch(chunks([...keys.keys()]).map((part) => store.db
    .prepare(`SELECT * FROM foods WHERE deletedAt IS NULL AND userEdited = 0 AND (source || ':' || sourceId) IN (${marks(part)})`).bind(...part)));
  const rows = [];
  for (const food of out.flatMap((r) => r.results).map((r) => fromDb('foods', r))) {
    const f = keys.get(sourceKey(food));
    const next = { name: f.name, brand: f.brand, barcode: f.barcode, per100g: f.per100g, carbsIncludeFibre: f.carbsIncludeFibre ? 1 : 0, servings: f.servings };
    const changed = Object.entries(next).some(([k, v]) => JSON.stringify(food[k]) !== JSON.stringify(v));
    if (changed) rows.push({ ...food, ...next, fetchedAt: f.fetchedAt });
  }
  return rows;
}

/** Saves fetched source foods to the cache (and refreshes your copies of them) in one write. */
async function keep(ctx, foods, extra = []) {
  const stamped = foods.map((f) => ({ ...f, carbsIncludeFibre: f.carbsIncludeFibre ? 1 : 0, fetchedAt: ctx.now }));
  const statements = [...stamped.map((f) => cacheStatement(ctx.store.db, f, ctx.now)), ...extra];
  const own = await refreshedOwn(ctx.store, stamped);
  await ctx.store.write(own.length ? { foods: own } : {}, ctx.now, { extra: statements });
  return stamped;
}

/** A statement for source foods whose names hold every word of query (from one source, or all), or null. */
function wordsStatement(db, query, source = null) {
  const words = nameWords(query);
  if (!words.length) return null;
  return db.prepare(`SELECT * FROM sourceFoods WHERE ${source ? 'source = ? AND ' : ''}${words.map(() => 'nameNorm LIKE ?').join(' AND ')} LIMIT 200`)
    .bind(...(source ? [source] : []), ...words.map((w) => `%${w}%`));
}

/** For each query, every cached source food whose name holds every word, in one call (for matching parsed items). */
export async function searchCachedMany(db, queries) {
  const statements = queries.map((query) => wordsStatement(db, query));
  const asked = statements.filter(Boolean);
  const out = asked.length ? await db.batch(asked) : [];
  let k = 0;
  return statements.map((st) => (st ? out[k++].results.map(fromCache) : []));
}

/** Which sources are on: the sources setting, and USDA only with its key. */
export const sourcesOn = (settings, env) => ({
  cofid: settings.sources?.cofid !== false,
  sgfoodid: settings.sources?.sgfoodid !== false,
  off: settings.sources?.off !== false,
  usda: settings.sources?.usda !== false && !!env.USDA_API_KEY,
});

/** A searchCache row's statement: the source foods a query found. */
const rememberStatement = (db, id, source, norm, foods, now) => db.prepare(`INSERT INTO searchCache (id, source, queryNorm, sourceFoodIds, fetchedAt) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET sourceFoodIds = excluded.sourceFoodIds, fetchedAt = excluded.fetchedAt`)
  .bind(id, source, norm, JSON.stringify(foods.map(sourceKey)), now);

/**
 * Searches for several queries ([{ query, state }]) at once: for each, CoFID, then SG FoodID, then
 * Open Food Facts, then USDA, each best first and only foods whose names hold every word. A source that can't be
 * reached is left out and named in unavailable. Four calls to D1 at most, however many queries:
 * the imported sources and the recent searches, the cached foods they found, then your foods and the write.
 * Returns [{ results: [Food], unavailable: ['off' | 'usda'] }] in the queries' order.
 */
export async function searchMany(ctx, env, queries, settings) {
  const db = ctx.store.db;
  const on = sourcesOn(settings, env);
  const asks = queries.map(({ query, state = null }) => ({ norm: normaliseName(query), state }));
  const norms = [...new Set(asks.map((a) => a.norm).filter(Boolean))];
  const sources = ['off', 'usda'].filter((source) => on[source]);
  const searches = norms.flatMap((norm) => sources.map((source) => ({ id: `${source}:${norm}`, source, norm })));

  const imports = IMPORTED.filter((source) => on[source]).flatMap((source) => norms.map((norm) => ({ key: `${source}:${norm}`, st: wordsStatement(db, norm, source) })));
  const cacheStatements = chunks(searches.map((s) => s.id)).map((part) => db.prepare(`SELECT * FROM searchCache WHERE id IN (${marks(part)})`).bind(...part));
  const reads = [...imports.map((i) => i.st).filter(Boolean), ...cacheStatements];
  const out = reads.length ? await db.batch(reads) : [];
  let k = 0;
  const imported = new Map(imports.map(({ key, st }) => [key, st ? out[k++].results.map(fromCache) : []]));
  const hits = new Map(out.slice(k).flatMap((r) => r.results)
    .filter((row) => ctx.now - row.fetchedAt < SEARCH_FRESH_MS).map((row) => [row.id, JSON.parse(row.sourceFoodIds)]));

  // Asked within 7 days: from the cache. Otherwise from the source itself.
  const byKey = new Map((await cached(db, [...hits.values()].flat())).map((f) => [sourceKey(f), f]));
  const found = new Map();
  const unavailable = new Map(norms.map((norm) => [norm, []]));
  const fetched = [];
  const remembers = [];
  await Promise.all(searches.map(async ({ id, source, norm }) => {
    if (hits.has(id)) {
      found.set(id, hits.get(id).map((key) => byKey.get(key)).filter(Boolean));
      return;
    }
    try {
      const list = (source === 'off' ? await fetchOff(ctx, norm) : await fetchUsda(ctx, env, norm)).filter(usable);
      const unique = [...new Map(list.map((f) => [sourceKey(f), f])).values()];
      found.set(id, unique);
      fetched.push(...unique);
      remembers.push(rememberStatement(db, id, source, norm, unique, ctx.now));
    } catch {
      unavailable.get(norm).push(source);
    }
  }));

  if (fetched.length) {
    const kept = await keep(ctx, [...new Map(fetched.map((f) => [sourceKey(f), f])).values()], remembers);
    const stamped = new Map(kept.map((f) => [sourceKey(f), f]));
    for (const [id, list] of found) if (!hits.has(id)) found.set(id, list.map((f) => stamped.get(sourceKey(f))));
  } else if (remembers.length) {
    await db.batch(remembers);
  }

  return asks.map(({ norm, state }) => {
    if (!norm) return { results: [], unavailable: [] };
    const lists = [...IMPORTED.map((source) => imported.get(`${source}:${norm}`) ?? []), found.get(`off:${norm}`) ?? [], found.get(`usda:${norm}`) ?? []];
    return { results: lists.flatMap((list) => rankFoods(norm, list, { state }).slice(0, PER_SOURCE)), unavailable: unavailable.get(norm).sort() };
  });
}

/** GET /search?q=: one query's { results, unavailable } (see searchMany). */
export async function searchFoods(ctx, env, query, settings, { state = null } = {}) {
  const [answer] = await searchMany(ctx, env, [{ query, state }], settings);
  return answer;
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
