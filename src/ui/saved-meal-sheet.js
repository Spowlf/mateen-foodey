// A saved meal: a name and its foods, each at its grams. Log a Saved Meal on Log logs them all.

import { h, fill, field, openSheet, toast } from './dom.js';
import { runAction, mealNow, loggedToast, deleteWithUndo, offlineLabel, keepUnits } from './format.js';
import { createLinesEditor } from './lines-editor.js';
import {
  linesWithFoods, linesTotal, storedLines, figuresText, unknownLines, today, mealName, titleCase,
} from '../engine/index.js';

/** Logs a saved meal's foods to meal, with Undo. Resolves true when logged. */
export async function logSavedMeal(repo, savedMeal, meal = mealNow(repo)) {
  const lines = linesWithFoods(savedMeal.items, repo.state.foods);
  const entries = await runAction(() => repo.logLines({ lines, date: today(), meal, origin: 'manual', savedMealId: savedMeal.id }));
  if (!entries) return false;
  loggedToast(repo, entries);
  return true;
}

/** "3 foods, 540 kcal" */
export function savedMealSub(savedMeal, foods) {
  const lines = linesWithFoods(savedMeal.items, foods);
  const total = linesTotal(lines);
  const n = lines.length;
  return keepUnits([`${n} ${n === 1 ? 'food' : 'foods'}`, total && figuresText(total.amounts, total).split(', ')[0]].filter(Boolean).join(', '));
}

/** openSavedMealSheet({ repo, savedMeal }): savedMeal null adds a new one. */
export function openSavedMealSheet({ repo, savedMeal = null }) {
  const isNew = !savedMeal;
  const start = linesWithFoods(savedMeal?.items ?? [], repo.state.foods);
  let busy = false;
  let dirty = isNew;

  const name = h('input', {
    class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done',
    value: savedMeal?.name ?? '', placeholder: 'Usual breakfast', oninput: () => { dirty = true; render(); },
  });
  const editor = createLinesEditor({
    repo, lines: start, what: 'food', placeholder: 'Porridge oats, or 40 g oats with 200 ml milk', fromMine: true,
    onChange: () => { dirty = true; render(); },
  });
  const together = h('div', { class: 'section', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });
  const meal = mealNow(repo);
  const logButton = h('button', { type: 'button', class: 'text-button', onclick: () => logNow() });

  function missing() {
    const lines = editor.lines();
    if (!name.value.trim()) return 'Enter a Name';
    if (!lines.length) return 'Add a Food';
    if (lines.some((l) => !(l.grams > 0))) return 'Enter the Grams';
    return null;
  }

  function render() {
    const total = linesTotal(editor.lines());
    fill(together, total && h('p', { class: 'headline-protein' }, keepUnits(`Together: ${figuresText(total.amounts, total)}`)),
      total && unknownLines(total.amounts).map((l) => h('p', { class: 'reason' }, l)));
    const blocked = offlineLabel(repo);
    const gap = missing();
    save.disabled = busy || !!blocked || !!gap || (!isNew && !dirty);
    save.textContent = busy ? 'Saving' : blocked ?? gap ?? (isNew ? 'Add Meal' : dirty ? 'Save Changes' : 'No Changes to Save');
    logButton.disabled = busy || !!blocked || !!gap;
    logButton.textContent = titleCase(`${dirty ? 'save and log' : 'log'} to ${mealName(meal).toLowerCase()}`);
  }

  async function store() {
    const id = savedMeal?.id ?? crypto.randomUUID();
    const result = await runAction(() => repo.saveWithFoods('savedMeals', editor.lines(), (lines) => ({
      id, name: name.value.trim(), items: storedLines(lines), deletedAt: null,
    })));
    return result ? result.changes.savedMeals?.[0] ?? null : null;
  }

  async function submit() {
    if (busy || missing()) return;
    busy = true;
    render();
    const row = await store();
    busy = false;
    if (!row) return render();
    s.close();
    toast(`${isNew ? 'Added' : 'Saved'} ${row.name}.`);
  }

  async function logNow() {
    if (busy || missing()) return;
    busy = true;
    render();
    const row = dirty ? await store() : savedMeal;
    const ok = row && await logSavedMeal(repo, row, meal);
    busy = false;
    if (ok) s.close();
    else render();
  }

  const s = openSheet({ title: isNew ? 'Add a Saved Meal' : savedMeal.name },
    h('div', { class: 'sheet-form' },
      field('Name', name),
      h('section', { class: 'section', 'aria-label': 'Foods' }, h('h3', { class: 'subhead' }, 'Foods'), editor.el),
      together,
      h('div', { class: 'sheet-actions' },
        save,
        h('div', { class: 'link-row' },
          logButton,
          !isNew && h('button', { type: 'button', class: 'text-button danger', onclick: async () => { if (await deleteWithUndo(repo, 'savedMeals', savedMeal)) s.close(); } }, 'Delete Meal')))));
  render();
  return s;
}
