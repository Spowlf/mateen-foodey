// The foods in a saved meal, a recipe or a batch: each line with its state (raw, cooked or as sold,
// since the food must match how it was weighed), its grams on the number pad, and Remove. Lines are
// added by search, by a sentence that goes through the check sheet, as on Log, or (for a saved meal)
// picked from your foods or your recipes. A recipe line is grams served from its latest batch.

import { h, fill, openSheet } from './dom.js';
import { runAction, keepUnits, foodSub } from './format.js';
import { createFoodSearch } from './food-search.js';
import { openGramsSheet } from './grams-sheet.js';
import { openCheckSheet } from './check-sheet.js';
import {
  amountsFor, kcalOf, formatKcal, formatGrams, formatDay, today, titleCase, myFoods, isLive, batchesOf, servedAmounts, unknownLines, servingSplits, nameCase,
} from '../engine/index.js';

const STATES = { raw: 'Raw', cooked: 'Cooked', asSold: 'As sold' };
// A short name searches as you type; a longer sentence waits for Check Items, as on Log.
const searchable = (text) => text.trim() && !/[,;]/.test(text) && text.trim().split(/\s+/).length <= 4;
const MINE_SHOWN = 50;

/** Your foods, most used first, with a search. onPick(food) runs on a tap, after the sheet closes. */
function openMyFoods({ repo, onPick }) {
  const list = h('div', { class: 'section' });
  const search = h('input', {
    class: 'input', type: 'search', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search your foods',
    placeholder: 'Search your foods', oninput: () => render(),
  });
  function render() {
    const foods = myFoods(repo.state.foods, search.value);
    fill(list, foods.length
      ? h('ul', { class: 'list', 'aria-label': 'Your foods' }, foods.slice(0, MINE_SHOWN).map((food) => h('li', {},
        h('button', { type: 'button', class: 'list-row', onclick: () => { s.close(); onPick(food); } },
          h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, nameCase(food.name)), h('span', { class: 'list-sub' }, foodSub(food)))))))
      : h('p', { class: 'empty-line' }, search.value.trim() ? 'None of your foods match. Try fewer words.' : 'Foods you log or add appear here.'));
  }
  const s = openSheet({ title: 'My Foods' }, h('div', { class: 'sheet-form' }, search, list));
  render();
  return s;
}

const madeOn = (date) => (date === today() ? 'today' : formatDay(date));

const SHARES = { 3: 'A Third', 4: 'A Quarter', 5: 'A Fifth' };

/** The grams sheet's measure for grams served from a recipe's batch: a third, a quarter or a fifth of it to pick. */
const batchMeasure = (recipe, batch) => ({
  title: nameCase(recipe.name),
  amounts: (g) => servedAmounts(batch, g),
  estimated: !!batch.totals.estimated,
  assumptions: batch.ingredients.filter((l) => l.estimated && l.assumptions).map((l) => l.assumptions).join(' ') || null,
  unknown: unknownLines(batch.totals),
  choices: servingSplits(batch.totals, batch.finishedGrams).map(({ count, grams, nutrition }) => ({
    value: `share:${count}`, label: `${SHARES[count]}, ${formatGrams(grams)}`, grams, amounts: nutrition,
  })),
  note: keepUnits(`From the batch made ${madeOn(batch.date)}, ${formatGrams(batch.finishedGrams)} finished. Logging the meal uses the latest batch.`),
});

/** Your recipes that have been made. onPick(recipe, batch) runs on a tap, after the sheet closes. */
function openMyRecipes({ repo, onPick }) {
  const S = repo.state;
  const made = S.recipes.filter(isLive)
    .map((recipe) => ({ recipe, batch: batchesOf(S.batches, recipe.id)[0] }))
    .filter((r) => r.batch)
    .sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, 'en-GB'));
  const s = openSheet({ title: 'My Recipes' }, h('div', { class: 'sheet-form' }, made.length
    ? h('ul', { class: 'list', 'aria-label': 'Your recipes' }, made.map(({ recipe, batch }) => h('li', {},
      h('button', { type: 'button', class: 'list-row', onclick: () => { s.close(); onPick(recipe, batch); } },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, nameCase(recipe.name)),
          h('span', { class: 'list-sub' }, keepUnits(`Made ${madeOn(batch.date)}, ${formatGrams(batch.finishedGrams)}`)))))))
    : h('p', { class: 'empty-line' }, 'Make a recipe once, and it can go in a saved meal.')));
  return s;
}

/**
 * createLinesEditor({ repo, lines, what, placeholder, fromMine, onChange }) → { el, lines() }. lines
 * are { food, grams, portionBasis }; onChange(lines) runs after every change. what names a line
 * ("ingredient", "food") in labels; fromMine adds "Choose from My Foods" and "Choose from Recipes".
 */
export function createLinesEditor({ repo, lines: start, what = 'food', placeholder, fromMine = false, onChange }) {
  let lines = start.map((l) => ({ ...l }));
  let busy = false;
  const list = h('div', {});
  const update = (next) => { lines = next; render(); onChange(lines); };

  function row(line, i) {
    const name = nameCase(line.recipe ? line.recipe.name : line.food.name);
    const amounts = !(line.grams > 0) ? null
      : line.recipe ? (line.batch ? servedAmounts(line.batch, line.grams) : null) : amountsFor(line.food.per100g, line.grams, line.food);
    const kcal = amounts ? kcalOf(amounts.kcalMilli) : null;
    const estimated = line.recipe ? !!line.batch?.totals.estimated : line.food.source === 'estimate' || line.portionBasis === 'guessed';
    const kind = line.recipe ? (line.batch ? 'Recipe' : 'Recipe, not made yet') : STATES[line.food.state] ?? null;
    const sub = [kind, kcal == null ? null : `${estimated ? '~' : ''}${formatKcal(kcal)}`].filter(Boolean).join(', ');
    const setGrams = ({ grams, portionBasis }) => update(lines.map((l, k) => (k === i ? { ...l, grams, portionBasis } : l)));
    return h('li', { class: 'check-row' },
      h('button', {
        type: 'button', class: 'list-row', disabled: line.recipe && !line.batch,
        'aria-label': `${name}, ${line.grams ? formatGrams(line.grams) : 'no grams yet'}. Change the grams`,
        onclick: () => openGramsSheet(line.recipe
          ? { measure: batchMeasure(line.recipe, line.batch), grams: line.grams, verb: 'Use', onDone: setGrams }
          : { food: line.food, grams: line.grams, portionBasis: line.portionBasis, verb: 'Use', onDone: setGrams }),
      },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, name),
        sub && h('span', { class: 'list-sub' }, keepUnits(sub))),
      h('span', { class: `list-amount${line.grams ? '' : ' missing'}` }, line.grams ? formatGrams(line.grams) : 'Grams')),
      h('button', { type: 'button', class: 'text-button', 'aria-label': `Remove ${name}`, onclick: () => update(lines.filter((_, k) => k !== i)) }, 'Remove'));
  }

  const box = h('textarea', {
    class: 'input', rows: 1, autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'go',
    'aria-label': titleCase(`add ${what}s`), placeholder,
    oninput: () => renderAdd(),
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } },
  });
  const checkButton = h('button', { type: 'button', class: 'text-button', onclick: () => check() });
  const pick = (food) => openGramsSheet({
    food, grams: food.usualGrams ?? null, verb: 'Add',
    onDone: ({ grams, portionBasis }) => {
      box.value = '';
      results.clear();
      renderAdd();
      update([...lines, { food, grams, portionBasis }]);
    },
  });
  const results = createFoodSearch({ repo, onPick: pick });
  const pickRecipe = (recipe, batch) => openGramsSheet({
    measure: batchMeasure(recipe, batch), verb: 'Add',
    onDone: ({ grams }) => update([...lines, { recipe, batch, grams, portionBasis: 'typed' }]),
  });
  const mineButton = fromMine && h('div', { class: 'link-row' },
    h('button', { type: 'button', class: 'text-button', onclick: () => openMyFoods({ repo, onPick: pick }) }, 'Choose from My Foods'),
    h('button', { type: 'button', class: 'text-button', onclick: () => openMyRecipes({ repo, onPick: pickRecipe }) }, 'Choose from Recipes'));

  function renderAdd() {
    const text = box.value.trim();
    const connected = repo.connected();
    checkButton.hidden = !text || searchable(text);
    checkButton.disabled = busy || !connected;
    checkButton.textContent = busy ? 'Reading the Items' : connected ? 'Check Items' : 'Connect to Check Items';
    if (searchable(box.value)) results.search(box.value);
    else results.clear();
  }

  async function check() {
    const text = box.value.trim();
    if (busy || !text) return;
    if (searchable(text)) return;
    busy = true;
    renderAdd();
    const data = await runAction(() => repo.parse({ text }));
    busy = false;
    renderAdd();
    if (!data) return;
    const parsed = data.items.map((it) => ({
      name: it.name, food: it.food, grams: it.grams, portionBasis: it.portionBasis, alternatives: it.alternatives ?? [],
      state: it.state, searchTerm: it.searchTerm, matchedFrom: it.matchedFrom,
    }));
    openCheckSheet({
      repo, lines: parsed, verb: 'add', onChange: () => {},
      onLog: (checked) => {
        box.value = '';
        renderAdd();
        update([...lines, ...checked.map((l) => ({ food: l.food, grams: l.grams, portionBasis: l.portionBasis }))]);
        return true;
      },
    });
  }

  function render() {
    fill(list, lines.length > 0 && h('ul', { class: 'list', 'aria-label': titleCase(`${what}s`) }, lines.map(row)));
  }

  const el = h('div', { class: 'section' }, list, h('div', { class: 'add' }, box, h('div', {}, checkButton), mineButton, results.el));
  render();
  renderAdd();
  return { el, lines: () => lines };
}
