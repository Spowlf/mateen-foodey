// The Mateen Foodey API: a Cloudflare Worker in front of D1.
//
//   GET    /sync?since=rev        everything changed after rev (0 = everything)
//   PUT    /:table/:id            add or edit a row; a body whose id differs from the address is refused
//   DELETE /:table/:id            soft delete (Undo is a PUT with deletedAt: null)
//   POST   /batch                 rows of several tables in one write, all or nothing: { foods?, entries?, ... }
//   GET    /search?q=             source foods: CoFID, Open Food Facts, USDA ({ results, unavailable })
//   GET    /barcode/:code         a packaged food from Open Food Facts ({ food })
//   POST   /parse                 sentence or photo logging, steps 1 to 3: { text } or { image: { mediaType, data } }
//   POST   /health                the Health Shortcut: { date, activeKcal, steps, weightKg, workouts }; text
//   GET    /health/weights?from=&to=  weights typed in the app, for the Shortcut to write to Health
//   GET    /summary?date=         the weekly summary for the week before the one date falls in, as text
//   POST   /summary               the same from the phone's timestamp: { timestamp }
//   POST   /restore               replace everything with a backup file's contents
//
// Every route needs "Authorization: Bearer <API_TOKEN>". Writes reply { rev, changes }.
// The Worker never works out "today": every date comes from the phone. The one exception is the
// cost guard's UTC day (claude.js). It never logs the token or food data.

import { readBackup, reviewWeek, reviewWeekFromTimestamp, weekSummary, weeklyText, validDate, TABLES } from '../../src/engine/index.js';
import { createStore } from './store.js';
import { HttpError, json, text, withCors, authorised, readJson, refuse } from './http.js';
import { saveRow, saveBatch, deleteRow, ensureSeeded, settingsOf } from './rows.js';
import { searchFoods, lookupBarcode, validBarcode } from './sources.js';
import { parseFood } from './parse.js';
import { syncHealth, typedWeights } from './health.js';

const TEXT_ROUTES = new Set(['health', 'summary']);
const STATES = new Set(['raw', 'cooked', 'asSold']);

// Databases known to be seeded, so a warm Worker skips that query.
const seeded = new WeakSet();

async function context(env, deps) {
  const now = deps.now ?? Date.now();
  const store = createStore(env.DB);
  if (!seeded.has(env.DB)) {
    await ensureSeeded(store, now);
    seeded.add(env.DB);
  }
  return { store, now, env, fetch: deps.fetch ?? ((...args) => fetch(...args)) };
}

async function summaryText(ctx, start) {
  const [entries, days, weights, targets, activity, workouts, settings] = await Promise.all([
    ...['entries', 'days', 'weights', 'targets', 'activity', 'workouts'].map((t) => ctx.store.live(t)),
    settingsOf(ctx.store),
  ]);
  const summary = weekSummary({ entries, days, weights, targets, settings, activity, workouts, start });
  return weeklyText(summary, { weightUnit: settings.weightUnit });
}

async function route(request, ctx) {
  const url = new URL(request.url);
  let parts;
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  const [first, id, ...rest] = parts;
  const method = request.method;
  if (rest.length) return null;

  if (method === 'GET' && first === 'sync' && !id) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    return json(await ctx.store.since(since));
  }
  if (method === 'POST' && first === 'batch' && !id) return json(await saveBatch(ctx, await readJson(request)));
  if (method === 'GET' && first === 'search' && !id) {
    const state = url.searchParams.get('state');
    const settings = await settingsOf(ctx.store);
    return json(await searchFoods(ctx, ctx.env, url.searchParams.get('q') ?? '', settings, { state: STATES.has(state) ? state : null }));
  }
  if (method === 'GET' && first === 'barcode' && id) {
    if (!validBarcode(id)) throw refuse('enter the 8 to 14 digits under the barcode.');
    return json(await lookupBarcode(ctx, id));
  }
  if (method === 'POST' && first === 'parse' && !id) return json(await parseFood(ctx, await readJson(request)));
  if (method === 'POST' && first === 'health' && !id) return text(await syncHealth(ctx, await readJson(request)));
  if (method === 'GET' && first === 'health' && id === 'weights') return json(await typedWeights(ctx, url.searchParams.get('from'), url.searchParams.get('to')));
  if ((method === 'GET' || method === 'POST') && first === 'summary' && !id) {
    let start;
    if (method === 'POST') start = reviewWeekFromTimestamp((await readJson(request)).timestamp);
    else if (validDate(url.searchParams.get('date'))) start = reviewWeek(url.searchParams.get('date'));
    if (!start) throw refuse(method === 'POST' ? 'send the phone’s timestamp.' : 'send the date from the phone.');
    return text(await summaryText(ctx, start));
  }
  if (method === 'POST' && first === 'restore' && !id) {
    const check = readBackup(await readJson(request));
    if (!check.ok) throw new HttpError(400, check.message);
    return json(await ctx.store.replaceAll(check.data.tables, ctx.now));
  }
  if (!id || !TABLES[first]?.clientWrites) return null;
  if (method === 'PUT') return json(await saveRow(ctx, first, id, await readJson(request)));
  if (method === 'DELETE') return json(await deleteRow(ctx, first, id));
  return null;
}

function failure(err, asText) {
  let status = 500;
  let message = 'Nothing changed: something went wrong on the server. Try again.';
  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (/UNIQUE constraint failed: foods/.test(err?.message)) {
    status = 409;
    message = 'Nothing changed: that food is already in your foods.';
  } else if (/constraint failed/.test(err?.message)) {
    status = 400;
    message = 'Nothing changed: some details are missing or not allowed.';
  } else {
    // The error's kind and place only: never the request, which holds the token and food data.
    console.error(err?.name ?? 'Error', err?.stack?.split('\n')[1]?.trim() ?? '');
  }
  return asText ? text(message, status) : json({ error: message }, status);
}

/** Handles one request. deps lets tests fix the clock and fake the sources and the model. */
export async function handle(request, env, deps = {}) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env);
  const first = new URL(request.url).pathname.split('/')[1];
  const asText = TEXT_ROUTES.has(first);
  let response;
  if (!authorised(request, env)) {
    response = failure(new HttpError(401, 'Check the backend token in Settings.'), asText);
  } else {
    try {
      const ctx = await context(env, deps);
      response = (await route(request, ctx)) ?? failure(new HttpError(404, 'Nothing changed: there is nothing at this address.'), asText);
    } catch (err) {
      response = failure(err, asText);
    }
  }
  return withCors(response, request, env);
}

export default {
  fetch: (request, env) => handle(request, env),
};
