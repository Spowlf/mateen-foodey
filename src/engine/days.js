// Honest gaps: each past day is unreviewed until marked complete or incomplete. Today is never marked.
// Only complete days count in the maintenance estimate and the weekly average.

import { addDays, datesFrom } from './dates.js';
import { isLive, dayTotal } from './entries.js';
import { titleCase } from './text.js';

/** A day eaten under this share of its target is asked about on its own ("Was Tuesday complete?"). */
export const FLAG_PERCENT = 60;

/** 'complete', 'incomplete' or 'unreviewed' (no row). Days rows have the date as their id. */
export function dayState(days, date) {
  return days.find((d) => isLive(d) && d.id === date)?.state ?? 'unreviewed';
}

export const completeDates = (days) => new Set(days.filter((d) => isLive(d) && d.state === 'complete').map((d) => d.id));

/** Under 60% of the day's target. A day with no target is never flagged. */
export const isFlagged = (eatenMilli, targetKcal) => targetKcal > 0 && (eatenMilli ?? 0) * 100 < FLAG_PERCENT * targetKcal * 1000;

/**
 * The reviewed week's unreviewed days, split: toMark (unflagged, confirmed together by "Mark N Days
 * Complete") and flagged (asked about one by one). Today and later are never included.
 * targetKcal(date) gives the day's target in kcal, or null.
 */
export function reviewDays({ weekStart, today, days, entries, targetKcal }) {
  const toMark = [];
  const flagged = [];
  for (const date of datesFrom(weekStart, addDays(weekStart, 6))) {
    if (date >= today || dayState(days, date) !== 'unreviewed') continue;
    (isFlagged(dayTotal(entries, date).kcalMilli, targetKcal(date)) ? flagged : toMark).push(date);
  }
  return { toMark, flagged };
}

/** "Mark 5 Days Complete", "Mark 1 Day Complete". */
export const markDaysLabel = (n) => titleCase(`mark ${n} ${n === 1 ? 'day' : 'days'} complete`);

/** The days rows that mark dates. */
export const dayRows = (dates, state) => dates.map((date) => ({ id: date, state }));
