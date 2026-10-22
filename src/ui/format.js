// Small wording and error helpers the screens share.

import { toast } from './dom.js';
import { OfflineError } from '../errors.js';
import { kcalOf, formatKcal } from '../engine/index.js';

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
