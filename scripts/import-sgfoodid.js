// Imports SG FoodID (the Singapore Food Insights Database, from Singapore's Health Promotion Board)
// into the source cache, once, as CoFID is. It has no download file or published API, so this reads
// the JSON its own website reads: each food group's list a page at a time, then each food's details,
// one at a time and slowing down whenever it says to wait (about 2,700 foods take a while).
// https://pphtpc.hpb.gov.sg/web/sgfoodid
//
//   node scripts/import-sgfoodid.js                          fetches every food, prints what it will import
//   node scripts/import-sgfoodid.js --save <file.json>       also keeps what it fetched, as it goes, and
//                                                            carries on from it when run again
//   node scripts/import-sgfoodid.js --from <file.json>       reads a kept file instead of fetching
//   add --apply to write to D1 (npx wrangler, --remote), or --apply --local for .dev.db (or DEV_DB)
//
// "Trace" is 0 and "no data" unknown; salt = sodium × 2.5; drinks' figures per 100 ml are taken per
// 100 g (see fromSgFoodId). Its licence asks for a notice with the date the data was accessed: after
// an import, set SGFOODID_ACCESSED in src/engine/sources.js to that day. Running it again updates
// the cache; your own foods are never changed by it.

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fromSgFoodId, normaliseName, sourceKey, formatKcal, SGFOODID_ACCESSED } from '../src/engine/index.js';

export const API = 'https://pphtpc.hpb.gov.sg/bff/v1/food-portal';
export const DATABASE = 'mateen-foodey';
const PAGE = 25;
const TRIES = 3;          // for failures; "too many requests" is waited out however often it comes
const MAX_WAITS = 30;
const USER_AGENT = 'MateenFoodey/1.0 (a personal food tracker; https://github.com/spowlf/mateen-foodey)';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * JSON from the website, tried again after a pause when it fails. "Too many requests" (429) is waited
 * out for as long as it says, and pace.ms grows so later requests come slower. Some of its text holds
 * control characters JSON doesn't allow.
 */
async function getJson(fetch, path, pace) {
  let failures = 0;
  let waits = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(`${API}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (res.status === 429 && waits < MAX_WAITS) {
        waits += 1;
        pace.ms = Math.min(Math.max(pace.ms * 2, pace.base), pace.max);
        await sleep((Number(res.headers.get('Retry-After')) || 30) * 1000 * pace.scale + pace.ms);
        continue;
      }
      if (!res.ok) throw new Error(`${path} answered ${res.status}`);
      return JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, ' '));
    } catch (err) {
      failures += 1;
      if (failures >= TRIES) throw err;
      await sleep(pace.base * 4 * failures);
    }
  }
}

/**
 * Every food's details: the food groups' lists, then each food once, one at a time. Drinks are listed
 * together, whichever drink group is asked. have holds details already fetched, which aren't asked
 * again; kept(details) runs every 100 foods with all so far. Returns the details as the website gives them.
 * paceMs is the pause between requests, which grows when the website says to wait (scale shortens waits in tests).
 */
export async function crawl({ fetch = globalThis.fetch, log = console.log, have = [], kept = () => {}, paceMs = 400, scale = 1 } = {}) {
  const pace = { ms: paceMs, base: paceMs, max: Math.max(paceMs, 5000 * scale), scale };
  const groups = await getJson(fetch, '/foods/groups', pace);
  const lists = [...groups.filter((g) => g.type !== 'Drink').map((g) => `foodGroupId=${g.id}`), ...(groups.some((g) => g.type === 'Drink') ? ['type=Drink'] : [])];
  const ids = new Set();
  for (const list of lists) {
    for (let page = 1; ; page++) {
      const foods = await getJson(fetch, `/foods?${list}&pageNumber=${page}`, pace);
      await sleep(pace.ms);
      for (const f of foods) if (f?.crId) ids.add(f.crId);
      if (foods.length < PAGE || page * PAGE >= (foods[0]?.totalCount ?? 0)) break;
    }
  }
  const details = have.filter((d) => ids.has(d?.crId));
  const done = new Set(details.map((d) => d.crId));
  const n = (x) => x.toLocaleString('en-GB');
  log(`Found ${n(ids.size)} foods${done.size ? `, ${n(done.size)} already fetched` : ''}. Fetching each one's details.`);
  for (const id of ids) {
    if (done.has(id)) continue;
    details.push(await getJson(fetch, `/foods/details/${encodeURIComponent(id)}`, pace));
    if (details.length % 100 === 0) {
      kept(details);
      log(`  ${n(details.length)} of ${n(ids.size)}`);
    }
    await sleep(pace.ms);
  }
  kept(details);
  return details.sort((a, b) => (a.crId < b.crId ? -1 : 1));
}

/** The foods, ready for the cache: { foods, skipped }. skipped are foods with no energy, which can't be logged. */
export function sgFoods(details) {
  const foods = [];
  const skipped = [];
  const seen = new Set();
  for (const d of details) {
    const food = fromSgFoodId(d);
    if (!food.sourceId || !food.name || seen.has(food.sourceId)) continue;
    seen.add(food.sourceId);
    if (food.per100g.kcalTenths == null) skipped.push(food.name);
    else foods.push(food);
  }
  return { foods, skipped };
}

const sql = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** One upsert per food, as SQL text for wrangler d1 execute. */
export function sgSql(foods, now) {
  return foods.map((f) => `INSERT INTO sourceFoods (id, source, sourceId, name, nameNorm, brand, barcode, state, per100g, carbsIncludeFibre, servings, fetchedAt) VALUES (${[
    sourceKey(f), 'sgfoodid', f.sourceId, f.name, normaliseName(f.name), null, null, f.state, JSON.stringify(f.per100g), 0, JSON.stringify(f.servings), now,
  ].map(sql).join(', ')}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, nameNorm = excluded.nameNorm, state = excluded.state, per100g = excluded.per100g, servings = excluded.servings, fetchedAt = excluded.fetchedAt;`).join('\n');
}

const grams = (mg) => (mg == null ? 'unknown' : `${(mg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} g`);

/** What the import will do, for a person to read before --apply. */
export function summary({ foods, skipped }) {
  const n = (x) => x.toLocaleString('en-GB');
  const lines = [`SG FoodID: ${n(foods.length)} foods to import.`];
  if (skipped.length) lines.push(`${n(skipped.length)} left out with no energy: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '; …' : ''}`);
  lines.push(`Fibre unknown for ${n(foods.filter((f) => f.per100g.fibreMg == null).length)}, salt unknown for ${n(foods.filter((f) => f.per100g.saltMg == null).length)}.`, '', 'For example, per 100 g:');
  const step = Math.max(1, Math.floor(foods.length / 5));
  for (let i = 0; i < foods.length && lines.length < 10; i += step) {
    const f = foods[i];
    const p = f.per100g;
    lines.push(`  ${f.sourceId} ${f.name} (${f.state}): ${formatKcal(Math.round(p.kcalTenths / 10))}, ${grams(p.proteinMg)} protein, ${grams(p.carbsMg)} carbs, ${grams(p.fatMg)} fat, ${grams(p.fibreMg)} fibre, ${grams(p.saltMg)} salt`);
  }
  return lines.join('\n');
}

async function main(args) {
  const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const from = after('--from');
  const save = after('--save');
  const have = save && existsSync(save) ? JSON.parse(readFileSync(save, 'utf8')) : [];
  const details = from ? JSON.parse(readFileSync(from, 'utf8')) : await crawl({ have, kept: (sofar) => save && writeFileSync(save, JSON.stringify(sofar)) });
  const result = sgFoods(details);
  console.log(summary(result));
  if (!args.includes('--apply')) {
    console.log('\nNothing written. Run again with --apply to write them (add --local for .dev.db).');
    return;
  }
  const now = Date.now();
  if (args.includes('--local')) {
    const { sqliteD1 } = await import('./sqlite-d1.js');
    const root = fileURLToPath(new URL('..', import.meta.url));
    const db = sqliteD1(process.env.DEV_DB ?? join(root, '.dev.db'));
    await db.exec(`BEGIN; ${sgSql(result.foods, now)} COMMIT;`);
    console.log(`\nWrote ${result.foods.length.toLocaleString('en-GB')} foods to ${process.env.DEV_DB ?? '.dev.db'}.`);
  } else {
    const path = join(mkdtempSync(join(tmpdir(), 'sgfoodid-')), 'sgfoodid.sql');
    writeFileSync(path, sgSql(result.foods, now));
    execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', `--file=${path}`], { stdio: 'inherit' });
    console.log(`\nWrote ${result.foods.length.toLocaleString('en-GB')} foods to D1.`);
  }
  const day = new Date(now).toISOString().slice(0, 10);
  if (!from && day !== SGFOODID_ACCESSED) console.log(`Set SGFOODID_ACCESSED in src/engine/sources.js to '${day}' for the notice in Settings.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Nothing written: ${err.message}`);
    process.exit(1);
  });
}
