// Recipes and batches. A recipe is what goes in; a batch is one time it's made, with its
// ingredients' nutrition copied in and its finished weight: the sum of the ingredients, or the dish
// as weighed, without its pot. Logging from a batch takes grams served, or portions when it's split.

import { h, fill, field, openSheet, toast } from './dom.js';
import { runAction, mealNow, loggedToast, deleteWithUndo, offlineLabel, keepUnits } from './format.js';
import { createLinesEditor } from './lines-editor.js';
import { openGramsSheet } from './grams-sheet.js';
import {
  linesWithFoods, linesTotal, storedLines, figuresText, unknownLines, today, formatDay, formatGrams, formatKcal, kcalOf, titleCase,
  batchesOf, nextIngredients, makeBatch, leftText, servedAmounts, portions, portionsLogged, portionsLeft, batchEntry,
  sumGrams,
} from '../engine/index.js';

const MAX_CHOICES = 4;
const whole = (input) => (/^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : null);
const numberInput = (attrs) => h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'done', ...attrs });

/** "today" or "23 Oct 2026" */
const madeOn = (date) => (date === today() ? 'today' : formatDay(date));

/** "Made today, ~1,050 g left" or "Not made yet" */
export function recipeSub(recipe, { batches, entries }) {
  const last = batchesOf(batches, recipe.id)[0];
  return keepUnits(last ? `Made ${madeOn(last.date)}, ${leftText(last, entries)}` : 'Not made yet');
}

/** "~1,050 g left of 1,610 g, 2 of 4 portions left" */
function batchSub(batch, entries) {
  const left = batch.portions ? `, ${portionsLeft(batch, entries)} of ${batch.portions} portions left` : '';
  return keepUnits(`${leftText(batch, entries)} of ${formatGrams(batch.finishedGrams)}${left}`);
}

/** Serves from a batch: grams on the number pad, or portions as chips when it's split. */
export function openBatchLog({ repo, batch, recipe }) {
  const S = repo.state;
  const from = portionsLogged(batch, S.entries) + 1;
  const left = portionsLeft(batch, S.entries);
  const choices = Array.from({ length: Math.min(left, MAX_CHOICES) }, (_, i) => {
    const k = i + 1;
    const part = portions(batch, from, k);
    return { value: `portions:${k}`, label: k === 1 ? '1 Portion' : `${k} Portions`, grams: part.grams, amounts: part.nutrition, count: k };
  });
  const assumptions = batch.ingredients.filter((l) => l.estimated && l.assumptions).map((l) => l.assumptions).join(' ') || null;
  return openGramsSheet({
    grams: choices[0]?.grams ?? null,
    portionBasis: choices.length ? 'serving' : null,
    verb: 'Log',
    measure: {
      title: recipe.name,
      amounts: (g) => servedAmounts(batch, g),
      estimated: !!batch.totals.estimated,
      assumptions,
      unknown: unknownLines(batch.totals),
      choices,
      note: `Made ${madeOn(batch.date)}. ${batchSub(batch, S.entries).replace(/^./, (c) => c.toUpperCase())}.`,
      extra: (close) => h('div', {}, h('button', {
        type: 'button', class: 'text-button', onclick: () => { close(); openBatchEditor({ repo, recipe, batch }); },
      }, 'Edit Batch')),
    },
    onDone: async ({ grams, choice }) => {
      const entry = batchEntry({
        id: crypto.randomUUID(), batch, name: recipe.name, date: today(), meal: mealNow(repo), createdAt: Date.now(),
        ...(choice ? { portionNumber: from, portionCount: choice.count } : { grams }),
      });
      const saved = await runAction(() => repo.saveRow('entries', entry.id, entry));
      if (!saved) return false;
      loggedToast(repo, [entry]);
      return true;
    },
  });
}

/**
 * Making a recipe, or changing a batch: its date, ingredients (from the last batch, or the recipe the
 * first time), finished weight and portions.
 */
export function openBatchEditor({ repo, recipe, batch = null }) {
  const S = repo.state;
  const isNew = !batch;
  const start = linesWithFoods(batch ? batch.ingredients : nextIngredients(recipe, S.batches), S.foods);
  let weighing = batch?.weighedGrams != null;
  let busy = false;

  const date = h('input', { class: 'input', type: 'date', value: batch?.date ?? today(), max: today(), oninput: () => render() });
  const editor = createLinesEditor({
    repo, lines: start, what: 'ingredient', onChange: () => render(),
  });
  const weighed = numberInput({ value: batch?.weighedGrams ? String(batch.weighedGrams) : '', oninput: () => render() });
  const count = numberInput({ value: batch?.portions ? String(batch.portions) : '', placeholder: 'Optional', oninput: () => render() });
  const finished = h('div', { class: 'section' });
  const finishedLine = h('p', { 'aria-live': 'polite' });
  const together = h('div', { class: 'section', 'aria-live': 'polite' });
  const problem = h('p', { class: 'warning', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function attempt() {
    const lines = editor.lines();
    if (!lines.length) return { label: 'Add an Ingredient' };
    if (lines.some((l) => !(l.grams > 0))) return { label: 'Enter the Grams' };
    if (weighing && whole(weighed) == null) return { label: 'Enter the Weight' };
    if (!date.value) return { label: 'Pick the Date' };
    const portionCount = count.value.trim() ? whole(count) ?? -1 : null;
    return makeBatch({
      id: batch?.id ?? 'preview', recipeId: recipe.id, date: date.value, lines,
      weighedGrams: weighing ? whole(weighed) : null, portions: portionCount,
    });
  }

  /** The finished weight's parts: redrawn when weighing starts or stops. */
  function renderFinished() {
    if (!weighing) {
      return fill(finished, finishedLine,
        h('p', { class: 'reason' }, 'Cooking changes the weight. Weigh the dish for exact portions.'),
        h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => { weighing = true; renderFinished(); render(); weighed.focus(); } }, 'Weigh the Finished Dish')));
    }
    fill(finished,
      field('Weight g', weighed, 'Zero the scales with the empty pot on before you cook.'),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => { weighing = false; renderFinished(); render(); } }, 'Use the Sum Instead')),
      finishedLine);
  }

  /** "1,610 g, as weighed." */
  function finishedText() {
    const lines = editor.lines();
    if (!weighing) {
      return lines.length && lines.every((l) => l.grams > 0) ? `${formatGrams(sumGrams(lines))}, the sum of the ingredients.` : 'The sum of the ingredients, once each has its grams.';
    }
    const g = whole(weighed);
    if (g == null) return 'Enter what the dish weighs, without its pot.';
    return `${formatGrams(g)}, as weighed.`;
  }

  function render() {
    finishedLine.textContent = keepUnits(finishedText());
    const result = attempt();
    const b = result.batch;
    fill(together, b && h('p', { class: 'headline-protein' }, keepUnits(`Together: ${figuresText(b.totals, { estimated: b.totals.estimated })}`)),
      b && h('p', { class: 'reason' }, keepUnits(`${formatGrams(b.finishedGrams)} finished, ${b.totals.estimated ? '~' : ''}${formatKcal(kcalOf(Math.round((b.totals.kcalMilli ?? 0) * 100 / b.finishedGrams)))} per 100 g.`)),
      b && unknownLines(b.totals).map((l) => h('p', { class: 'reason' }, l)));
    problem.hidden = !result.error;
    problem.textContent = result.error ?? '';
    const blocked = offlineLabel(repo);
    save.disabled = busy || !!blocked || !b;
    save.textContent = busy ? 'Saving' : blocked ?? result.label ?? (result.error ? 'Check the Details' : 'Save Batch');
  }

  async function submit() {
    if (busy || !attempt().batch) return;
    busy = true;
    render();
    const id = batch?.id ?? crypto.randomUUID();
    let made = null;
    const result = await runAction(() => repo.saveWithFoods('batches', editor.lines(), (lines) => {
      made = makeBatch({
        id, recipeId: recipe.id, date: date.value, lines,
        weighedGrams: weighing ? whole(weighed) : null, portions: count.value.trim() ? whole(count) : null,
      }).batch;
      return made;
    }));
    busy = false;
    if (!result) return render();
    s.close();
    toast(keepUnits(`Saved ${recipe.name}: ${formatGrams(made.finishedGrams)}, ready on Log’s quick log.`));
  }

  const s = openSheet({ title: isNew ? `Make ${recipe.name}` : recipe.name },
    h('div', { class: 'sheet-form' },
      field('Date Made', date),
      h('section', { class: 'section', 'aria-label': 'Ingredients' }, h('h3', { class: 'subhead' }, 'Ingredients'), editor.el),
      h('section', { class: 'section', 'aria-label': 'Finished Weight' }, h('h3', { class: 'subhead' }, 'Finished Weight'), finished),
      field('Portions', count, 'Split it to log a portion at a time. Leave blank to log by grams.'),
      together,
      h('div', { class: 'sheet-actions' },
        problem,
        save,
        !isNew && h('div', {}, h('button', {
          type: 'button', class: 'text-button danger',
          onclick: async () => { if (await deleteWithUndo(repo, 'batches', { id: batch.id, name: `${recipe.name}, made ${madeOn(batch.date)}` })) s.close(); },
        }, 'Delete Batch')))));
  renderFinished();
  render();
  return s;
}

/** A recipe's name and ingredients. A new one opens the recipe once saved, ready to make. */
export function openRecipeEditor({ repo, recipe = null }) {
  const isNew = !recipe;
  let busy = false;
  let dirty = isNew;
  const name = h('input', {
    class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done',
    value: recipe?.name ?? '', oninput: () => { dirty = true; render(); },
  });
  const editor = createLinesEditor({
    repo, lines: linesWithFoods(recipe?.ingredients ?? [], repo.state.foods), what: 'ingredient',
    onChange: () => { dirty = true; render(); },
  });
  const together = h('div', { class: 'section', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function missing() {
    if (!name.value.trim()) return 'Enter a Name';
    if (!editor.lines().length) return 'Add an Ingredient';
    if (editor.lines().some((l) => !(l.grams > 0))) return 'Enter the Grams';
    return null;
  }

  function render() {
    const total = linesTotal(editor.lines());
    fill(together, total && h('p', { class: 'headline-protein' }, keepUnits(`Together: ${figuresText(total.amounts, total)}`)),
      total && unknownLines(total.amounts).map((l) => h('p', { class: 'reason' }, l)));
    const blocked = offlineLabel(repo);
    save.disabled = busy || !!blocked || !!missing() || !dirty;
    save.textContent = busy ? 'Saving' : blocked ?? missing() ?? (isNew ? 'Add Recipe' : dirty ? 'Save Changes' : 'No Changes to Save');
  }

  async function submit() {
    if (busy || missing()) return;
    busy = true;
    render();
    const id = recipe?.id ?? crypto.randomUUID();
    const result = await runAction(() => repo.saveWithFoods('recipes', editor.lines(), (lines) => ({
      id, name: name.value.trim(), ingredients: storedLines(lines), deletedAt: null,
    })));
    busy = false;
    if (!result) return render();
    const saved = result.changes.recipes?.[0];
    s.close();
    toast(`${isNew ? 'Added' : 'Saved'} ${saved.name}.`);
    if (isNew) openRecipeSheet({ repo, recipe: saved });
  }

  const s = openSheet({ title: isNew ? 'Add a Recipe' : `Edit ${recipe.name}` },
    h('div', { class: 'sheet-form' },
      field('Name', name),
      h('section', { class: 'section', 'aria-label': 'Ingredients' },
        h('h3', { class: 'subhead' }, 'Ingredients'),
        h('p', { class: 'reason' }, 'Weigh each as it goes in, raw or as sold.'),
        editor.el),
      together,
      h('div', { class: 'sheet-actions' },
        save,
        !isNew && h('div', {}, h('button', { type: 'button', class: 'text-button danger', onclick: async () => { if (await deleteWithUndo(repo, 'recipes', recipe)) s.close(); } }, 'Delete Recipe')))));
  render();
  return s;
}

/** A recipe: its batches (tap one to log from it), then Make It / Make Again. */
export function openRecipeSheet({ repo, recipe }) {
  const S = repo.state;
  const batches = batchesOf(S.batches, recipe.id);
  const lines = linesWithFoods(recipe.ingredients, S.foods);
  const total = linesTotal(lines);
  const blocked = offlineLabel(repo);
  const n = lines.length;
  const s = openSheet({ title: recipe.name },
    h('div', { class: 'sheet-form' },
      h('p', { class: 'reason' }, keepUnits(`${n} ${n === 1 ? 'ingredient' : 'ingredients'}${total ? `, ${figuresText(total.amounts, total).split(', ')[0]} together` : ''}.`)),
      h('section', { class: 'section', 'aria-label': 'Batches' },
        h('h3', { class: 'subhead' }, 'Batches'),
        batches.length
          ? h('ul', { class: 'list' }, batches.slice(0, 6).map((b) => h('li', {},
            h('button', { type: 'button', class: 'list-row', onclick: () => { s.close(); openBatchLog({ repo, batch: b, recipe }); } },
              h('span', { class: 'list-main' },
                h('span', { class: 'list-title' }, titleCase(madeOn(b.date))),
                h('span', { class: 'list-sub' }, batchSub(b, S.entries)))))))
          : h('p', { class: 'empty-line' }, 'Not made yet. Make it to log it by grams or portions.')),
      h('div', { class: 'sheet-actions' },
        h('button', {
          type: 'button', class: 'button primary', disabled: !!blocked,
          onclick: () => { s.close(); openBatchEditor({ repo, recipe }); },
        }, blocked ?? (batches.length ? 'Make Again' : 'Make It')),
        h('div', { class: 'link-row' },
          h('button', { type: 'button', class: 'text-button', onclick: () => { s.close(); openRecipeEditor({ repo, recipe }); } }, 'Edit Recipe')))));
  return s;
}
