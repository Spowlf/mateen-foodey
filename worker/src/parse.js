// Sentence and photo logging on the Worker: steps 1 to 3 in one request.
//   1. Parse: the text or photo becomes items with names and grams (no nutrition is taken from it).
//   2. Match: each item against your foods, then the source cache, then Open Food Facts and USDA.
//   3. Estimate: only items nothing matched, with the assumptions behind each estimate.
// The phone shows the check sheet (step 4) and saves the entries (step 5). POST /log, the sentence
// Shortcut, runs all five and saves the entries as To check.

import {
  PARSE_SCHEMA, ESTIMATE_SCHEMA, cleanParse, cleanEstimate, portionBasisFor, rankFoods, normaliseName, sourceKey,
  foodEntry, partsFromIso, mealForTime, MAX_GRAMS,
} from '../../src/engine/index.js';
import { askJson } from './claude.js';
import { refuse, HttpError } from './http.js';
import { searchCached, searchFoods, sourcesOn } from './sources.js';
import { saveBatch, settingsOf } from './rows.js';

const MAX_TEXT = 1000;
const MAX_IMAGE_BASE64 = 2_000_000;   // about 1.5 MB: a 1,024 px JPEG is far smaller
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const OWN_FOODS_IN_PROMPT = 30;
const ALTERNATIVES = 5;

const PARSE_SYSTEM = `You read what someone in the UK ate and list each food as a separate item. Give no nutrition.
For each item:
- name: a short plain name in sentence case, such as "Fried egg" or "Flat white".
- quantity and unit: as given ("2", "slice"), or null.
- grams: the weight eaten in whole grams, your best estimate from the amount given or a typical UK portion.
- gramsAssumed: false when an amount, count or weight was given (or they said their usual portion); true when you guessed the portion.
- state: raw, cooked or asSold, for how the food was weighed or eaten; unknown if you can't tell.
- searchTerm: two to four words to find it in a UK food database, such as "egg fried" or "bread white toasted".
If an item is one of the person's own foods listed, use that food's exact name as the searchTerm, and its usual grams when they say "my usual" or give no amount.
Split dishes into their parts only when the parts were named ("toast with butter" is toast and butter).`;

const ESTIMATE_SYSTEM = `You estimate typical UK nutrition per 100 g for foods that weren't found in a food database.
Return one result per item, in the same order, with the same name.
Give kcal and protein, carbs (fibre excluded, as on UK labels), fat, fibre, sugars and salt in grams per 100 g, as eaten in the state given.
Use null for a nutrient you can't estimate sensibly.
assumptions: one or two short sentences saying what the estimate rests on, such as "Assumed oats made with 200 ml semi-skimmed milk and 1 tsp honey."`;

/** The text or image sent, checked. Returns the user message's content blocks. */
function input(body) {
  if (typeof body.text === 'string') {
    const text = body.text.trim();
    if (!text) throw refuse('type what you ate.');
    if (text.length > MAX_TEXT) throw refuse(`keep it under ${MAX_TEXT.toLocaleString('en-GB')} characters.`);
    return { blocks: [{ type: 'text', text: `What I ate: ${text}` }], text };
  }
  const image = body.image;
  if (image && IMAGE_TYPES.includes(image.mediaType) && typeof image.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
    if (image.data.length > MAX_IMAGE_BASE64) throw refuse('send a smaller photo.');
    return {
      blocks: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: 'What I ate is in this photo.' },
      ],
      text: null,
    };
  }
  throw refuse('type what you ate, or add a photo.');
}

const ownList = (foods) => foods.map((f) => `- ${f.name}${f.usualGrams ? ` (usual ${f.usualGrams} g)` : ''}`).join('\n');

/** The best match for an item and the next few: your foods, then the cache, then the sources. */
async function matchItem(ctx, item, own, settings, on) {
  const term = item.searchTerm;
  const state = item.state;
  const found = (list, from) => (list.length ? { food: list[0], matchedFrom: from, alternatives: list.slice(1, 1 + ALTERNATIVES) } : null);
  const mine = found(rankFoods(term, own, { state }), 'foods');
  if (mine) return mine;
  const cache = rankFoods(term, (await searchCached(ctx.store.db, term)).filter((f) => on[f.source]), { state });
  if (cache.length) return found(cache, cache[0].source);
  const { results } = await searchFoods(ctx, ctx.env, term, settings, { state });
  return results.length ? found(results, results[0].source) : { food: null, matchedFrom: null, alternatives: [] };
}

/** Estimates for the items nothing matched, in their order (null where the model gave none). */
async function estimates(ctx, items, text) {
  const list = items.map((it, i) => `${i + 1}. ${it.name}${it.grams ? `, ${it.grams} g` : ''}${it.state ? `, ${it.state}` : ''}`).join('\n');
  const context = text ? `\nThey wrote: ${text}` : '';
  const { data, callsLeft } = await askJson(ctx, {
    system: ESTIMATE_SYSTEM,
    content: [{ type: 'text', text: `Items:\n${list}${context}` }],
    schema: ESTIMATE_SCHEMA,
  });
  const got = cleanEstimate(data);
  const byName = new Map(got.map((f) => [normaliseName(f.name), f]));
  const sameOrder = got.length === items.length;
  return {
    foods: items.map((it, i) => byName.get(normaliseName(it.name)) ?? (sameOrder ? got[i] : null)),
    callsLeft,
  };
}

/**
 * POST /parse { text } or { image: { mediaType, data } }: steps 1 to 3.
 * Returns { items: [{ name, quantity, unit, grams, gramsAssumed, state, portionBasis, food, matchedFrom,
 * alternatives }], callsLeft }. food is your own food (with its id), a source food or an estimate
 * (without an id: the phone gives it one when it's logged), or null when nothing was found.
 */
export async function parseFood(ctx, body, { origin = 'sentence' } = {}) {
  const { blocks, text } = input(body);
  if (body.image && origin === 'sentence') origin = 'photo';
  const [settings, own] = await Promise.all([settingsOf(ctx.store), ctx.store.live('foods')]);
  const on = sourcesOn(settings, ctx.env);
  const usual = [...own].sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || (a.name < b.name ? -1 : 1)).slice(0, OWN_FOODS_IN_PROMPT);

  const intro = usual.length ? [{ type: 'text', text: `My own foods, most logged first:\n${ownList(usual)}` }] : [];
  const parsed = await askJson(ctx, { system: PARSE_SYSTEM, content: [...intro, ...blocks], schema: PARSE_SCHEMA });
  let callsLeft = parsed.callsLeft;
  const items = cleanParse(parsed.data);
  if (!items.length) throw refuse('no food was found in that. Try naming each food.', 422);

  const matches = await Promise.all(items.map((it) => matchItem(ctx, it, own, settings, on)));
  const unmatched = items.map((it, i) => (matches[i].food ? null : i)).filter((i) => i != null);
  if (unmatched.length) {
    try {
      const est = await estimates(ctx, unmatched.map((i) => items[i]), text);
      callsLeft = est.callsLeft;
      unmatched.forEach((i, k) => {
        const food = est.foods[k];
        if (food) matches[i] = { food: { ...food, state: items[i].state ?? food.state, fetchedAt: null }, matchedFrom: 'estimate', alternatives: [] };
      });
    } catch (err) {
      // Matched items still go to the check sheet; the rest can be searched for.
      if (!(err instanceof HttpError)) throw err;
    }
  }

  return {
    items: items.map((it, i) => ({ ...it, portionBasis: portionBasisFor({ gramsAssumed: it.gramsAssumed, origin }), ...matches[i] })),
    callsLeft,
  };
}

const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const names = (list) => list.map(lowerFirst).join(', ');

const items = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

/** The Shortcut's reply, in the words it was sent: "3 items to check: eggs, toast, flat white." */
function logReply(saved, missing) {
  const lines = [`${items(saved.length)} to check: ${names(saved)}.`];
  if (missing.length) lines.push(`Search for ${names(missing)} in the app.`);
  return lines.join(' ');
}

/**
 * POST /log { text, timestamp }: the sentence Shortcut. Parses and matches as /parse does, then saves
 * the entries as To check on the phone's date, in the meal slot for the phone's time. Entry ids come
 * from the timestamp, so a retry adds nothing and makes no model call. Replies with one line of text.
 */
export async function logSentence(ctx, body) {
  const parts = partsFromIso(body.timestamp);
  if (!parts || typeof body.text !== 'string') throw refuse('send the text and the phone’s timestamp.');
  const base = `shortcut:${parts.at}`;
  const already = await ctx.store.all('entries', 'id LIKE ? AND deletedAt IS NULL ORDER BY id', `${base}:%`);
  if (already.length) return `Already saved: ${items(already.length)} to check.`;

  const parsed = await parseFood(ctx, { text: body.text }, { origin: 'shortcut' });
  const settings = await settingsOf(ctx.store);
  const meal = mealForTime(parts.time, settings.mealTimes);
  const own = new Map((await ctx.store.live('foods')).filter((f) => f.sourceId).map((f) => [sourceKey(f), f]));
  const foods = new Map();
  const entries = [];
  const saved = [];
  const missing = [];
  parsed.items.forEach((it, i) => {
    if (!it.food) { missing.push(it.name); return; }
    let food = it.food;
    if (!food.id) {
      const key = food.source === 'estimate' ? null : sourceKey(food);
      food = (key && (own.get(key) ?? foods.get(key))) ?? { ...food, id: crypto.randomUUID(), useCount: 0, userEdited: 0, deletedAt: null };
      if (!own.has(key)) foods.set(key ?? food.id, food);
    }
    const guess = it.grams == null;
    const grams = Math.min(MAX_GRAMS, it.grams ?? food.usualGrams ?? food.servings?.[0]?.grams ?? 100);
    entries.push(foodEntry({
      id: `${base}:${i}`, food, grams, date: parts.date, meal, portionBasis: guess ? 'guessed' : it.portionBasis,
      origin: 'shortcut', status: 'toCheck', createdAt: parts.at,
    }));
    saved.push(it.name);
  });
  if (!entries.length) throw refuse(`nothing matched. Search for ${names(missing)} in the app.`, 422);
  await saveBatch(ctx, { foods: [...foods.values()], entries });
  return logReply(saved, missing);
}
