// The foods in a saved meal, a recipe or a batch: each line with its state (raw, cooked or as sold,
// since the food must match how it was weighed), its grams on the number pad, and Remove. Lines are
// added by search, by a sentence that goes through the check sheet, as on Log, or (for a saved meal)
// picked from your foods.

import { h, fill, openSheet } from './dom.js';
import { runAction, keepUnits, foodSub } from './format.js';
import { createFoodSearch } from './food-search.js';
import { openGramsSheet } from './grams-sheet.js';
import { openCheckSheet } from './check-sheet.js';
import { amountsFor, kcalOf, formatKcal, formatGrams, titleCase, myFoods } from '../engine/index.js';

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
          h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, food.name), h('span', { class: 'list-sub' }, foodSub(food)))))))
      : h('p', { class: 'empty-line' }, search.value.trim() ? 'None of your foods match. Try fewer words.' : 'Foods you log or add appear here.'));
  }
  const s = openSheet({ title: 'My Foods' }, h('div', { class: 'sheet-form' }, search, list));
  render();
  return s;
}

/**
 * createLinesEditor({ repo, lines, what, placeholder, fromMine, onChange }) → { el, lines() }. lines
 * are { food, grams, portionBasis }; onChange(lines) runs after every change. what names a line
 * ("ingredient", "food") in labels; fromMine adds "Choose from My Foods".
 */
export function createLinesEditor({ repo, lines: start, what = 'food', placeholder, fromMine = false, onChange }) {
  let lines = start.map((l) => ({ ...l }));
  let busy = false;
  const list = h('div', {});
  const update = (next) => { lines = next; render(); onChange(lines); };

  function row(line, i) {
    const kcal = line.grams > 0 ? kcalOf(amountsFor(line.food.per100g, line.grams, line.food).kcalMilli) : null;
    const estimated = line.food.source === 'estimate' || line.portionBasis === 'guessed';
    const sub = [STATES[line.food.state] ?? null, kcal == null ? null : `${estimated ? '~' : ''}${formatKcal(kcal)}`].filter(Boolean).join(', ');
    return h('li', { class: 'check-row' },
      h('button', {
        type: 'button', class: 'list-row', 'aria-label': `${line.food.name}, ${line.grams ? formatGrams(line.grams) : 'no grams yet'}. Change the grams`,
        onclick: () => openGramsSheet({
          food: line.food, grams: line.grams, portionBasis: line.portionBasis, verb: 'Use',
          onDone: ({ grams, portionBasis }) => update(lines.map((l, k) => (k === i ? { ...l, grams, portionBasis } : l))),
        }),
      },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, line.food.name),
        sub && h('span', { class: 'list-sub' }, keepUnits(sub))),
      h('span', { class: `list-amount${line.grams ? '' : ' missing'}` }, line.grams ? formatGrams(line.grams) : 'Grams')),
      h('button', { type: 'button', class: 'text-button', 'aria-label': `Remove ${line.food.name}`, onclick: () => update(lines.filter((_, k) => k !== i)) }, 'Remove'));
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
  const mineButton = fromMine && h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openMyFoods({ repo, onPick: pick }) }, 'Choose from My Foods'));

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
