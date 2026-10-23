// Backup (JSON, every row) and CSV export (entries, for a spreadsheet).
// A backup holds deleted rows too, so an entry whose food was deleted still finds it, and a
// restore can check every reference.

import { TABLES, SYNCED } from './tables.js';
import { kcalOf, NUTRIENTS } from './nutrition.js';
import { formatDay } from './dates.js';

export const BACKUP_APP = 'mateen-foodey';
export const BACKUP_VERSION = 1;

/** Every row, as one JSON-ready object. state has one array per table. */
export function backupData(state, { now }) {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, tables: Object.fromEntries(SYNCED.map((name) => [name, state[name] ?? []])) };
}

const refuse = (message) => ({ ok: false, message: `Nothing changed: ${message}` });
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

// Each reference a row can make: [table, ids it names, table they're in, what it is]. The Worker checks them on every write too.
export const REFERENCES = [
  ['entries', (r) => [r.foodId], 'foods', 'an entry names a food'],
  ['entries', (r) => [r.batchId], 'batches', 'an entry names a batch'],
  ['entries', (r) => [r.savedMealId], 'savedMeals', 'an entry names a saved meal'],
  ['batches', (r) => [r.recipeId], 'recipes', 'a batch names a recipe'],
  ['batches', (r) => [r.potId], 'pots', 'a batch names a pot'],
  ['batches', (r) => (Array.isArray(r.ingredients) ? r.ingredients.map((l) => l?.foodId) : []), 'foods', 'a batch names a food'],
  ['recipes', (r) => (Array.isArray(r.ingredients) ? r.ingredients.map((l) => l?.foodId) : []), 'foods', 'a recipe names a food'],
  ['savedMeals', (r) => (Array.isArray(r.items) ? r.items.map((l) => l?.foodId) : []), 'foods', 'a saved meal names a food'],
  ['savedMeals', (r) => (Array.isArray(r.items) ? r.items.map((l) => l?.recipeId) : []), 'recipes', 'a saved meal names a recipe'],
];

/**
 * Checks a backup before anything is written: text that's valid JSON (or an already parsed object),
 * this app's backup, a list of rows per table, each with an id and its required fields, no id twice in
 * a table, and every reference between foods, recipes, batches, pots and entries found.
 * Returns { ok: true, data, exportedAt, counts, total } or { ok: false, message } ("Nothing changed: …").
 */
export function readBackup(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { return refuse('this file isn’t a backup.'); }
  }
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP || !data.tables || typeof data.tables !== 'object') {
    return refuse('this isn’t a Mateen Foodey backup.');
  }
  if (!(data.version <= BACKUP_VERSION)) return refuse('this backup is from a newer version of the app. Reload the app first.');

  const ids = {};
  for (const name of SYNCED) {
    const rows = data.tables[name] ?? [];
    if (!Array.isArray(rows)) return refuse('this backup is damaged.');
    ids[name] = new Set();
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return refuse('this backup is damaged.');
      if (ids[name].has(r.id)) return refuse('this backup has the same record twice.');
      ids[name].add(r.id);
      if (!r.deletedAt && TABLES[name].required.some((f) => blank(r[f]))) return refuse('this backup is missing some details.');
    }
  }
  for (const [name, refs, target, what] of REFERENCES) {
    for (const r of data.tables[name] ?? []) {
      if (refs(r).some((id) => id != null && !ids[target].has(id))) return refuse(`${what} that isn’t in the backup.`);
    }
  }
  const counts = Object.fromEntries(SYNCED.map((name) => [name, (data.tables[name] ?? []).length]));
  return { ok: true, data, exportedAt: Number(data.exportedAt) || null, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** One CSV cell: quoted when needed, and a leading = + - @ neutralised so a spreadsheet never runs it. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Grams to one decimal in the CSV, since a spreadsheet may add them up.
const oneDecimal = (ug) => (ug == null ? null : (Math.round(ug / 100_000) / 10).toFixed(1));

/** Live entries as CSV, oldest first. Unknown nutrients are blank cells, never 0. */
export function entriesCsv(entries) {
  const header = ['Date', 'Meal', 'Food', 'Grams', 'kcal', ...NUTRIENTS.map((n) => `${n[0].toUpperCase()}${n.slice(1)} g`), 'Nutrition', 'Portion', 'Status'];
  const rows = entries.filter((e) => !e.deletedAt).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0))).map((e) => [
    formatDay(e.date), e.meal, e.name, e.grams, kcalOf(e.nutrition.kcalMilli),
    ...NUTRIENTS.map((n) => oneDecimal(e.nutrition[`${n}Ug`])),
    e.nutritionBasis, e.portionBasis, e.status,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
