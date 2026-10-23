// Small wording and error helpers the screens share.

import { toast } from './dom.js';
import { OfflineError } from '../errors.js';
import { kcalOf, formatKcal, formatGrams, mealForTime, mealName, nowTime } from '../engine/index.js';

/** Runs an action from a tap; a failure becomes a toast that says nothing changed. Returns its result or null. */
export async function runAction(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OfflineError) toast('You’re offline. Nothing changed.');
    else if (err.message?.startsWith('Nothing changed')) toast(err.message);
    else toast(`Nothing changed: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`);
    return null;
  }
}

const SOURCES = { off: 'Open Food Facts', cofid: 'CoFID', usda: 'USDA', custom: 'Your food', estimate: 'Estimate' };
const STATES = { raw: 'raw', cooked: 'cooked', asSold: 'as sold' };

/** "Hovis, Open Food Facts, 233 kcal per 100 g" (the food's name is shown beside it). */
export function foodSub(food) {
  const kcal = kcalOf(food.per100g?.kcalTenths == null ? null : food.per100g.kcalTenths * 100);
  const text = [
    food.brand,
    food.id && food.source !== 'estimate' ? null : SOURCES[food.source],
    food.state === 'asSold' ? null : STATES[food.state],
    kcal == null ? 'kcal unknown' : `${food.source === 'estimate' ? '~' : ''}${formatKcal(kcal)} per 100 g`,
  ].filter(Boolean).join(', ');
  return keepUnits(text.charAt(0).toUpperCase() + text.slice(1));
}

/** A figure never splits from its unit at the end of a line ("100 g", "176 kcal"). */
export const keepUnits = (text) => String(text).replace(/(\d) (g|kcal|ml)\b/g, '$1\u00a0$2');

/** The meal slot for now, from the meal times in Settings. */
export const mealNow = (repo) => mealForTime(nowTime(), repo.setting('mealTimes') ?? undefined);

/**
 * "Logged 40 g Porridge oats to lunch." (a food's name keeps its own case), with Undo, which removes
 * the entries and then runs onUndo.
 */
export function loggedToast(repo, entries, { onUndo = null } = {}) {
  const n = entries.length;
  const what = n === 1 ? `${entries[0].grams ? `${formatGrams(entries[0].grams)} ` : ''}${entries[0].name}` : `${n} items`;
  toast(`Logged ${what} to ${entries[0] ? mealName(entries[0].meal).toLowerCase() : 'today'}.`, {
    label: 'Undo',
    run: () => runAction(async () => {
      await repo.deleteEntries(entries.map((e) => e.id));
      onUndo?.();
      toast('Removed.');
    }),
  });
}

/** Deletes a row, then "Deleted Chilli." with Undo. Resolves true when it was deleted. */
export async function deleteWithUndo(repo, table, row) {
  const done = await runAction(() => repo.deleteRow(table, row.id));
  if (!done) return false;
  toast(`Deleted ${row.name}.`, {
    label: 'Undo',
    run: () => runAction(async () => { await repo.restoreRow(table, row.id); toast(`${row.name} is back.`); }),
  });
  return true;
}

/** A button's label while it can't save: what's missing for that ("Connect to Save", "Needs a Connection"). */
export const offlineLabel = (repo) => (!repo.connected() ? 'Connect to Save' : !navigator.onLine ? 'Needs a Connection' : null);
