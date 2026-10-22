// Imports CoFID (McCance and Widdowson's Composition of Foods Integrated Dataset) into the source
// cache, once. Download the spreadsheet from
// https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid
// then:
//
//   node scripts/import-cofid.js <file.xlsx>                  prints what it will import
//   node scripts/import-cofid.js <file.xlsx> --apply          writes it to D1 (npx wrangler, --remote)
//   node scripts/import-cofid.js <file.xlsx> --apply --local  writes it to .dev.db (or DEV_DB) for npm run dev
//
// Energy, protein, fat, carbohydrate, sugars and AOAC fibre come from "1.3 Proximates"; sodium from
// "1.4 Inorganics", as salt = sodium × 2.5. "Tr" (trace) is 0, "N" and blanks are unknown. Fibre is
// AOAC fibre, the UK label method, and unknown when CoFID gives only NSP. Running it again updates
// the cache; your own foods are never changed by it.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readXlsx } from './xlsx.js';
import { fromCofid, normaliseName, sourceKey, formatKcal } from '../src/engine/index.js';

export const PROXIMATES = '1.3 Proximates';
export const INORGANICS = '1.4 Inorganics';
export const DATABASE = 'mateen-foodey';

// Each field's column, by CoFID's own code (the second header row), so a reordered sheet still reads.
const PROXIMATE_CODES = { kcal: 'KCALS', kj: 'KJ', protein: 'PROT', fat: 'FAT', carbohydrate: 'CHO', sugars: 'TOTSUG', fibre: 'AOACFIB' };

/** A sheet's data rows as objects, with columns found by the row holding the given codes. */
function table(rows, codes) {
  const at = rows.findIndex((r) => Object.values(codes).every((c) => r.includes(c)));
  if (at < 0) throw new Error(`can't find the columns ${Object.values(codes).join(', ')}`);
  const index = Object.fromEntries(Object.entries(codes).map(([k, c]) => [k, rows[at].indexOf(c)]));
  return rows.slice(at + 1)
    .map((r) => ({ code: (r[0] ?? '').trim(), name: (r[1] ?? '').trim(), ...Object.fromEntries(Object.entries(index).map(([k, i]) => [k, r[i] ?? ''])) }))
    .filter((r) => /^\d+-\d+$/.test(r.code) && r.name);
}

/**
 * The workbook's foods, ready for the cache. Returns { foods, skipped, fibreUnknown }:
 * skipped are foods with no energy, which can't be logged.
 */
export function cofidFoods(workbook) {
  const sodium = new Map(table(workbook.rows(INORGANICS), { sodium: 'NA' }).map((r) => [r.code, r.sodium]));
  const foods = [];
  const skipped = [];
  const seen = new Set();
  for (const row of table(workbook.rows(PROXIMATES), PROXIMATE_CODES)) {
    // A code listed twice keeps its first row.
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    const food = fromCofid({ ...row, sodium: sodium.get(row.code) ?? '' });
    if (food.per100g.kcalTenths == null) skipped.push(food.name);
    else foods.push(food);
  }
  return { foods, skipped, fibreUnknown: foods.filter((f) => f.per100g.fibreMg == null).length };
}

const sql = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** One upsert per food, as SQL text for wrangler d1 execute. */
export function cofidSql(foods, now) {
  return foods.map((f) => `INSERT INTO sourceFoods (id, source, sourceId, name, nameNorm, brand, barcode, state, per100g, carbsIncludeFibre, servings, fetchedAt) VALUES (${[
    sourceKey(f), 'cofid', f.sourceId, f.name, normaliseName(f.name), null, null, f.state, JSON.stringify(f.per100g), 0, '[]', now,
  ].map(sql).join(', ')}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, nameNorm = excluded.nameNorm, state = excluded.state, per100g = excluded.per100g, fetchedAt = excluded.fetchedAt;`).join('\n');
}

const grams = (mg) => (mg == null ? 'unknown' : `${(mg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} g`);

/** What the import will do, for a person to read before --apply. */
export function summary({ foods, skipped, fibreUnknown }) {
  const n = (x) => x.toLocaleString('en-GB');
  const lines = [`CoFID: ${n(foods.length)} foods to import.`];
  if (skipped.length) lines.push(`${n(skipped.length)} left out with no energy: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '; …' : ''}`);
  lines.push(`Fibre unknown for ${n(fibreUnknown)} (CoFID gives no AOAC fibre for them).`, '', 'For example, per 100 g:');
  const step = Math.max(1, Math.floor(foods.length / 5));
  for (let i = 0; i < foods.length && lines.length < 10; i += step) {
    const f = foods[i];
    const p = f.per100g;
    lines.push(`  ${f.sourceId} ${f.name} (${f.state}): ${formatKcal(Math.round(p.kcalTenths / 10))}, ${grams(p.proteinMg)} protein, ${grams(p.carbsMg)} carbs, ${grams(p.fatMg)} fat, ${grams(p.fibreMg)} fibre, ${grams(p.saltMg)} salt`);
  }
  return lines.join('\n');
}

async function main(args) {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.log('Usage: node scripts/import-cofid.js <CoFID .xlsx> [--apply] [--local]');
    process.exit(1);
  }
  const result = cofidFoods(readXlsx(readFileSync(file)));
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
    await db.exec(`BEGIN; ${cofidSql(result.foods, now)} COMMIT;`);
    console.log(`\nWrote ${result.foods.length.toLocaleString('en-GB')} foods to ${process.env.DEV_DB ?? '.dev.db'}.`);
    return;
  }
  const path = join(mkdtempSync(join(tmpdir(), 'cofid-')), 'cofid.sql');
  writeFileSync(path, cofidSql(result.foods, now));
  execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', `--file=${path}`], { stdio: 'inherit' });
  console.log(`\nWrote ${result.foods.length.toLocaleString('en-GB')} foods to D1.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Nothing written: ${err.message}`);
    process.exit(1);
  });
}
