// History: what you ate, a day at a time, newest first, each day with its state (complete,
// incomplete or unreviewed; today is never marked). Search by name; tap an entry to edit, confirm,
// copy or delete it; copy a meal or a whole day to today; mark a past day complete or incomplete.

import { h, fill, toast } from './dom.js';
import { runAction, keepUnits } from './format.js';
import { openEntrySheet, copyToToday } from './entry-sheet.js';
import {
  today, historyDays, dayLine, stateLabel, targetOn, mealName, formatDay, formatGrams, kcalOf, isEstimated, titleCase, isLive,
} from '../engine/index.js';

const DAYS_SHOWN = 14;

// The search and how far back you've looked are kept while you move between tabs.
let query = '';
let shown = DAYS_SHOWN;

export function renderHistory(root, { repo }) {
  const S = repo.state;
  const search = h('input', {
    class: 'input', type: 'search', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search what you ate',
    placeholder: 'Search what you ate', value: query, oninput: () => { query = search.value; renderDays(); },
  });
  const list = h('div', { class: 'screen' });
  fill(root, h('div', { class: 'screen' }, search, list));

  const settings = () => ({ floorKcal: repo.setting('floorKcal') ?? undefined, exerciseAddBackPct: repo.setting('exerciseAddBackPct') ?? undefined });
  const dayName = (date) => (date === today() ? 'Today' : formatDay(date));

  async function mark(date, state) {
    const before = S.days.find((d) => d.id === date && isLive(d))?.state ?? null;
    const ok = await runAction(() => repo.saveRow('days', date, { state, deletedAt: null }));
    if (!ok) return;
    toast(`Marked ${date === today() ? 'today' : formatDay(date)} ${state}.`, {
      label: 'Undo',
      run: () => runAction(async () => {
        if (before) await repo.saveRow('days', date, { state: before, deletedAt: null });
        else await repo.deleteRow('days', date);
        toast('Changed back.');
      }),
    });
  }

  function entryRow(e) {
    const kcal = kcalOf(e.nutrition.kcalMilli);
    const tags = [e.status === 'toCheck' && 'To check', e.nutritionBasis === 'estimate' && '~ Estimated', e.portionBasis === 'guessed' && '~ Portion guessed'].filter(Boolean);
    return h('li', {},
      h('button', { type: 'button', class: 'list-row', onclick: () => openEntrySheet({ repo, entry: e }) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, e.name),
          (e.grams || tags.length > 0) && h('span', { class: 'list-sub' }, keepUnits([e.grams && formatGrams(e.grams), ...tags].filter(Boolean).join(', ')))),
        kcal != null && h('span', { class: 'list-amount' }, keepUnits(`${isEstimated(e) ? '~' : ''}${kcal.toLocaleString('en-GB')} kcal`))));
  }

  function daySection(d) {
    const now = today();
    const target = targetOn({ targets: S.targets, settings: settings(), activity: S.activity, workouts: S.workouts, date: d.date });
    const label = stateLabel(d.state, d.date, now);
    const past = d.date < now;
    const all = d.meals.flatMap((m) => m.entries);
    return h('section', { class: 'section day', 'aria-label': dayName(d.date) },
      h('div', { class: 'day-head' },
        h('h2', { class: 'subhead' }, dayName(d.date), label && h('span', { class: `tag${d.state === 'unreviewed' ? ' tag-quiet' : ''}` }, label)),
        h('p', { class: 'reason' }, keepUnits(`${dayLine(S.entries, d.date, target?.kcal ?? null)}.`))),
      d.meals.map((m) => h('div', { class: 'meal-block' },
        h('div', { class: 'meal-head' },
          h('h3', {}, mealName(m.meal)),
          past && !query && h('button', {
            type: 'button', class: 'text-button', 'aria-label': `Copy ${mealName(m.meal).toLowerCase()} from ${dayName(d.date)} to today`,
            onclick: () => copyToToday(repo, m.entries),
          }, 'Copy to Today')),
        h('ul', { class: 'list' }, m.entries.map(entryRow)))),
      past && !query && h('div', { class: 'link-row' },
        d.state !== 'complete' && h('button', { type: 'button', class: 'text-button', onclick: () => mark(d.date, 'complete') }, 'Mark Complete'),
        d.state !== 'incomplete' && h('button', { type: 'button', class: 'text-button', onclick: () => mark(d.date, 'incomplete') }, 'Mark Incomplete'),
        h('button', { type: 'button', class: 'text-button', onclick: () => copyToToday(repo, all) }, titleCase('copy day to today'))));
  }

  function renderDays() {
    const days = historyDays({ entries: S.entries, days: S.days, query });
    if (!days.length) {
      return fill(list, query.trim()
        ? h('p', { class: 'empty-line' }, 'Nothing you ate matches. Try fewer words.')
        : h('section', { class: 'empty' }, h('h2', {}, 'Nothing logged yet'), h('p', {}, 'Everything you log appears here, a day at a time, with the day’s total.')));
    }
    fill(list,
      days.slice(0, shown).map(daySection),
      days.length > shown && h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => { shown += DAYS_SHOWN; renderDays(); } }, 'Show Earlier Days')),
      h('p', { class: 'reason' }, 'Only days marked complete count in your averages and the maintenance estimate.'));
  }

  renderDays();
  return { refresh: () => renderDays() };
}
