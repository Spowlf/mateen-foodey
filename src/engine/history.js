// History: what you ate, a day at a time, newest first, with each day's state. Entries can be
// searched, edited, deleted and copied to today (one, a meal, or a whole day).

import { isLive, entriesOn, dayTotal, isEstimated } from './entries.js';
import { dayState } from './days.js';
import { MEALS } from './meals.js';
import { nameWords } from './match.js';
import { AMOUNT_FIELDS, roundDiv, kcalOf, gramsOf, formatKcal, formatGrams } from './nutrition.js';
import { MAX_GRAMS } from './parse.js';

/** Does an entry's name hold every word of the search ("eggs" finds "Egg, boiled")? */
function matches(entry, want) {
  if (!want.length) return true;
  const have = new Set(nameWords(entry.name));
  return want.every((w) => have.has(w));
}

/**
 * Days with live entries, newest first: [{ date, state, meals: [{ meal, entries }] }], each meal's
 * entries in the order they were logged. A search keeps only the entries (and days) it matches.
 */
export function historyDays({ entries, days, query = '' }) {
  const want = nameWords(query);
  const byDate = new Map();
  for (const e of entries) {
    if (!isLive(e) || !matches(e, want)) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return [...byDate.keys()].sort().reverse().map((date) => {
    const list = byDate.get(date).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    return {
      date,
      state: dayState(days, date),
      meals: MEALS.map((meal) => ({ meal, entries: list.filter((e) => e.meal === meal) })).filter((m) => m.entries.length),
    };
  });
}

/** "1,840 kcal of 2,000, 92 g protein", with "~" when any entry is estimated. targetKcal may be null. */
export function dayLine(entries, date, targetKcal = null) {
  const total = dayTotal(entries, date);
  const t = entriesOn(entries, date).some(isEstimated) ? '~' : '';
  const kcal = kcalOf(total.kcalMilli) ?? 0;
  const protein = gramsOf(total.proteinUg);
  return [
    targetKcal ? `${t}${kcal.toLocaleString('en-GB')} of ${formatKcal(targetKcal)}` : `${t}${formatKcal(kcal)}`,
    protein != null && formatGrams(protein, 'protein'),
  ].filter(Boolean).join(', ');
}

/**
 * Copies of entries on date, for "Copy to Today": new ids, the same name, grams, nutrition, meal and
 * what they rest on, logged now. A copy of a To check entry is still to check.
 */
export function copyEntries(list, { date, newId, now }) {
  return list.filter(isLive).map((e) => ({
    ...Object.fromEntries(Object.entries(e).filter(([k]) => !['updatedAt', 'rev'].includes(k))),
    id: newId(), date, createdAt: now, deletedAt: null,
  }));
}

/**
 * An entry weighed again: its own copied nutrition scaled to the new grams (rounded once), so it
 * never picks up later edits to its food. The portion becomes typed. Returns the fields that change.
 */
export function rescaleEntry(entry, grams) {
  if (!Number.isInteger(grams) || grams < 1 || grams > MAX_GRAMS) throw new RangeError('grams must be a whole number from 1 to 5,000');
  if (!entry.grams) throw new RangeError('this entry has no grams');
  const nutrition = { ...entry.nutrition };
  for (const f of AMOUNT_FIELDS) nutrition[f] = entry.nutrition[f] == null ? null : roundDiv(entry.nutrition[f] * grams, entry.grams);
  return { grams, nutrition, portionBasis: 'typed' };
}

/** "Complete", "Incomplete", or "Unreviewed"; nothing for today, which is never marked. */
export const stateLabel = (state, date, today) => (date >= today ? null : { complete: 'Complete', incomplete: 'Incomplete', unreviewed: 'Unreviewed' }[state]);
