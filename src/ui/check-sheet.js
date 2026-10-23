// The check sheet (step 4 of sentence and photo logging): each item with its match (tap to swap),
// its grams (tap for the number pad), kcal and macros, Remove, and what's uncertain about it:
// "~ Estimated nutrition", "~ Portion guessed", or both, with the assumptions underneath. An item
// the sentence gave kcal for ("780 kcal") shows just that, with Remove.
// The button reads "Log 3 Items", or says what's missing.

import { h, fill, openSheet, icon, toast } from './dom.js';
import { foodSub, keepUnits, runAction } from './format.js';
import { openGramsSheet } from './grams-sheet.js';
import { createFoodSearch } from './food-search.js';
import {
  checkButton, lineAmounts, lineEstimated, kcalLine, figuresText, uncertainty, withGrams, sumAmounts, unknownLines, formatGrams, nameCase,
} from '../engine/index.js';

/**
 * Picks another food for a line: the parse's alternatives first, then a search, or Estimate Instead
 * when nothing listed is what you ate (one of the day's model calls).
 */
function openSwap({ repo, line, onPick }) {
  const input = h('input', {
    class: 'input', type: 'search', value: line.searchTerm ?? line.name, autocomplete: 'off', enterkeyhint: 'search',
    'aria-label': 'Search for a food', oninput: () => results.search(input.value, { state: line.state }),
  });
  const alternatives = (line.alternatives ?? []).filter((f) => f !== line.food);
  const pick = (food) => { onPick(food); s.close(); };
  const estimateButton = h('button', { type: 'button', class: 'text-button', onclick: () => estimate() }, 'Estimate Instead');
  async function estimate() {
    estimateButton.disabled = true;
    estimateButton.textContent = 'Estimating';
    const data = await runAction(() => repo.estimate({ name: line.name, grams: line.grams, state: line.state }));
    estimateButton.disabled = false;
    estimateButton.textContent = 'Estimate Instead';
    if (!data) return;
    pick(data.food);
    if (data.callsLeft <= 10) toast(`${data.callsLeft} sentence ${data.callsLeft === 1 ? 'log' : 'logs'} left today.`);
  }
  const results = createFoodSearch({
    repo,
    onPick: pick,
    extra: () => (alternatives.length ? [h('ul', { class: 'list', 'aria-label': 'Other matches' }, alternatives.map((food) => h('li', {},
      h('button', { type: 'button', class: 'list-row', onclick: () => pick(food) },
        h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, nameCase(food.name)), h('span', { class: 'list-sub' }, foodSub(food)))))))] : []),
  });
  const s = openSheet({ title: `Food for “${nameCase(line.name)}”` }, h('div', { class: 'sheet-form' }, input, h('div', {}, estimateButton), results.el));
  results.search(input.value, { state: line.state });
  return s;
}

/**
 * openCheckSheet({ repo, lines, onChange, onLog, verb }): lines are { name, food, grams, portionBasis,
 * alternatives, state }. onChange(lines) runs on every edit (the draft keeps them); onLog(lines) saves
 * and resolves true when done (the sheet closes) or false (it stays, with the lines kept).
 * verb 'add' makes the button "Add 3 Items", for a recipe or saved meal.
 */
export function openCheckSheet({ repo, lines: start, onChange, onLog, verb = 'log' }) {
  let lines = start.map((l) => ({ ...l }));
  let busy = false;
  const list = h('div', { class: 'lines' });
  const total = h('div', { class: 'section', 'aria-live': 'polite' });
  const button = h('button', { type: 'button', class: 'button primary', onclick: () => log() });

  const update = (next) => { lines = next; onChange(lines); render(); };
  const setLine = (i, line) => update(lines.map((l, k) => (k === i ? line : l)));

  const remove = (i) => h('button', { type: 'button', class: 'text-button', onclick: () => update(lines.filter((_, k) => k !== i)) }, 'Remove');

  // The kcal the sentence gave ("780 kcal"): logged as that, like a quick add, with no food or grams.
  const kcalCard = (line, i) => h('article', { class: 'line', 'aria-label': nameCase(line.name) },
    h('div', { class: 'line-head' },
      h('div', { class: 'list-main' },
        h('h3', { class: 'list-title' }, nameCase(line.name)),
        h('span', { class: 'list-sub' }, 'The kcal you gave'))),
    h('div', { class: 'line-foot' },
      h('span', { class: 'reason' }, keepUnits(figuresText(lineAmounts(line)))),
      remove(i)));

  function lineCard(line, i) {
    if (verb === 'log' && kcalLine(line)) return kcalCard(line, i);
    const amounts = lineAmounts(line);
    const estimated = lineEstimated(line);
    const tags = uncertainty(line);
    return h('article', { class: 'line', 'aria-label': nameCase(line.name) },
      h('div', { class: 'line-head' },
        h('div', { class: 'list-main' },
          h('h3', { class: 'list-title' }, nameCase(line.name)),
          h('button', {
            type: 'button', class: 'line-match', 'aria-label': line.food ? `${nameCase(line.food.name)}. Change the food` : `Pick a food for ${nameCase(line.name)}`,
            onclick: () => openSwap({ repo, line, onPick: (food) => setLine(i, { ...line, food }) }),
          }, h('span', {}, line.food ? nameCase(line.food.name) : 'Pick a Food'), icon('forward')),
          line.food && h('span', { class: 'list-sub' }, foodSub(line.food))),
        h('button', {
          type: 'button', class: `line-grams${line.grams ? '' : ' missing'}`, 'aria-label': line.grams ? `${line.grams} grams. Change` : 'Enter the grams',
          disabled: !line.food,
          onclick: () => openGramsSheet({ food: line.food, grams: line.grams, portionBasis: line.portionBasis, verb: 'Use', onDone: ({ grams, portionBasis }) => setLine(i, portionBasis === 'serving' ? { ...line, grams, portionBasis } : withGrams(line, grams)) }),
        }, line.grams ? formatGrams(line.grams) : 'Grams')),
      tags.length > 0 && h('div', { class: 'line-tags' }, tags.map((t) => h('span', { class: 'tag tag-warn' }, t))),
      line.food?.assumptions && h('p', { class: 'reason' }, line.food.assumptions),
      h('div', { class: 'line-foot' },
        h('span', { class: 'reason' }, amounts ? keepUnits(figuresText(amounts, { estimated })) : line.food ? 'Enter the grams.' : 'Nothing matched. Pick a food.'),
        remove(i)));
  }

  function render() {
    fill(list, lines.length ? lines.map(lineCard) : h('p', { class: 'empty-line' }, 'Every item was removed.'));
    const amounts = lines.map(lineAmounts).filter(Boolean);
    const sum = amounts.length ? sumAmounts(amounts) : null;
    const estimated = lines.some(lineEstimated);
    fill(total, sum && h('p', { class: 'headline-protein' }, keepUnits(`Together: ${figuresText(sum, { estimated })}`)),
      sum && unknownLines(sum).map((l) => h('p', { class: 'reason' }, l)));
    const state = checkButton(lines, verb);
    button.disabled = busy || !state.ready;
    button.textContent = busy ? (verb === 'log' ? 'Logging' : 'Adding') : state.label;
  }

  async function log() {
    if (busy || !checkButton(lines, verb).ready) return;
    busy = true;
    render();
    const done = await onLog(lines);
    busy = false;
    if (done) s.close();
    else render();
  }

  const s = openSheet({ title: 'Check the Items' }, h('div', { class: 'sheet-form' }, list, total, h('div', { class: 'sheet-actions' }, button)));
  render();
  return s;
}
