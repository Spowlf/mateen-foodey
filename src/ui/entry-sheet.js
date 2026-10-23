// One entry from History: what it rests on, then its grams, meal and day. Changing the grams scales
// its own copied nutrition, so a later edit to the food never reaches it. A To check entry is
// confirmed by saving it. Delete has Undo; Copy to Today logs it again today.

import { h, fill, chips, field, openSheet, toast } from './dom.js';
import { runAction, deleteWithUndo, offlineLabel, keepUnits } from './format.js';
import {
  MEALS, mealName, today, formatDay, formatGrams, figuresText, unknownLines, sumAmounts, rescaleEntry, isEstimated, typedWhole, MAX_GRAMS, titleCase, nameCase,
} from '../engine/index.js';

const NUTRITION = { database: null, estimate: '~ Estimated nutrition', quick: 'Quick add: typed kcal' };

/** Copies entries to today, with Undo. */
export async function copyToToday(repo, list) {
  const copies = await runAction(() => repo.copyEntries(list, today()));
  if (!copies) return false;
  const n = copies.length;
  toast(n === 1 ? `Copied ${nameCase(copies[0].name)} to today.` : `Copied ${n} items to today.`, {
    label: 'Undo',
    run: () => runAction(async () => { await repo.deleteEntries(copies.map((e) => e.id)); toast('Removed.'); }),
  });
  return true;
}

export function openEntrySheet({ repo, entry }) {
  const toCheck = entry.status === 'toCheck';
  let meal = entry.meal;
  let busy = false;

  const grams = entry.grams ? h('input', {
    class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'done', value: String(entry.grams), oninput: () => render(),
  }) : null;
  const date = h('input', { class: 'input', type: 'date', value: entry.date, max: today(), oninput: () => render() });
  const mealChips = chips({ label: 'Meal', className: 'fit', options: MEALS.map((m) => ({ value: m, label: mealName(m) })), value: meal, onChange: (m) => { meal = m; render(); } });
  const figures = h('div', { class: 'section', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  /** The fields that change, or { error }. */
  function changes() {
    const out = {};
    if (grams) {
      const g = typedWhole(grams.value);
      if (g == null || g < 1 || g > MAX_GRAMS) return { error: 'Enter the Grams' };
      if (g !== entry.grams) Object.assign(out, rescaleEntry(entry, g));
    }
    if (meal !== entry.meal) out.meal = meal;
    if (!date.value) return { error: 'Pick the Day' };
    if (date.value !== entry.date) out.date = date.value;
    if (toCheck) out.status = 'logged';
    return { out };
  }

  function render() {
    const c = changes();
    const nutrition = c.out?.nutrition ?? entry.nutrition;
    const portion = c.out?.portionBasis ?? entry.portionBasis;
    const tags = [NUTRITION[entry.nutritionBasis], portion === 'guessed' && '~ Portion guessed', toCheck && 'To check'].filter(Boolean);
    fill(figures,
      tags.length > 0 && h('div', { class: 'line-tags' }, tags.map((t) => h('span', { class: 'tag tag-warn' }, t))),
      h('p', { class: 'headline-protein' }, keepUnits(figuresText(nutrition, { estimated: isEstimated({ ...entry, portionBasis: portion }) }))),
      entry.assumptions && h('p', { class: 'reason' }, entry.assumptions),
      unknownLines(sumAmounts([nutrition])).map((l) => h('p', { class: 'reason' }, l)));
    const blocked = offlineLabel(repo);
    const changed = c.out && Object.keys(c.out).some((k) => k !== 'status');
    save.disabled = busy || !!blocked || !!c.error || (!toCheck && !changed);
    save.textContent = busy ? 'Saving' : blocked ?? c.error ?? (toCheck ? (changed ? 'Confirm Changes' : 'Confirm') : changed ? 'Save Changes' : 'No Changes to Save');
  }

  async function submit() {
    const c = changes();
    if (busy || c.error) return;
    busy = true;
    render();
    const before = Object.fromEntries(Object.keys(c.out).map((k) => [k, entry[k]]));
    const ok = await runAction(() => repo.saveRow('entries', entry.id, c.out));
    busy = false;
    if (!ok) return render();
    s.close();
    toast(toCheck ? `Confirmed ${nameCase(entry.name)}.` : `Saved ${nameCase(entry.name)}.`, {
      label: 'Undo',
      run: () => runAction(async () => { await repo.saveRow('entries', entry.id, before); toast('Changed back.'); }),
    });
  }

  const where = `${mealName(entry.meal)}, ${entry.date === today() ? 'today' : formatDay(entry.date)}${entry.grams ? `, ${formatGrams(entry.grams)}` : ''}.`;
  const s = openSheet({ title: nameCase(entry.name) },
    h('div', { class: 'sheet-form' },
      h('p', { class: 'reason' }, keepUnits(where)),
      figures,
      grams && field('Grams', grams, 'Its nutrition scales with the grams.'),
      field('Meal', mealChips),
      field('Day', date),
      h('div', { class: 'sheet-actions' },
        save,
        h('div', { class: 'link-row' },
          entry.date !== today() && h('button', { type: 'button', class: 'text-button', onclick: async () => { if (await copyToToday(repo, [entry])) s.close(); } }, titleCase('copy to today')),
          h('button', { type: 'button', class: 'text-button danger', onclick: async () => { if (await deleteWithUndo(repo, 'entries', { id: entry.id, name: nameCase(entry.name) })) s.close(); } }, 'Delete Entry')))));
  render();
  return s;
}
