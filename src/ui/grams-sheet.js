// The grams sheet: a food's servings and usual portion as chips, and a number pad for grams (or ml).
// Used to log a food, to change a check sheet line's grams, and to check a To check entry.

import { h, fill, chips, openSheet } from './dom.js';
import { keepUnits } from './format.js';
import {
  pressGramsKey, typedGrams, mlToGrams, amountsFor, figuresText, unknownLines, sumAmounts, formatGrams, titleCase, MAX_GRAMS,
} from '../engine/index.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

/**
 * openGramsSheet({ food, grams, portionBasis, verb, onDone }) — verb names the button ("Log", "Use",
 * "Confirm"); onDone({ grams, portionBasis }) runs on its tap and may return a promise (the sheet
 * stays open, its button disabled, until it settles; it closes unless it returns false).
 */
export function openGramsSheet({ food, grams = null, portionBasis = null, verb = 'Log', onDone }) {
  let text = grams ? String(grams) : '';
  let unit = 'g';
  let basis = portionBasis;
  let busy = false;

  const num = h('span', { class: 'num' });
  const unitLabel = h('span', { class: 'unit' });
  const display = h('output', { class: 'pad-display', 'aria-live': 'polite' }, num, unitLabel);
  const figures = h('p', { class: 'reason', 'aria-live': 'polite' });
  const notes = h('div', { class: 'lines' });
  const button = h('button', { type: 'button', class: 'button primary', onclick: () => done() });

  const servings = [
    food.usualGrams && { value: `usual:${food.usualGrams}`, label: `Usual, ${formatGrams(food.usualGrams)}`, grams: food.usualGrams, basis: 'typed' },
    ...(food.servings ?? []).map((s, i) => ({ value: `serving:${i}`, label: s.label, grams: s.grams, basis: 'serving' })),
  ].filter(Boolean);
  const servingChips = servings.length ? chips({
    label: 'Portion',
    options: servings,
    value: null,
    onChange: (v) => {
      const s = servings.find((x) => x.value === v);
      text = String(s.grams);
      unit = 'g';
      unitChips.set('g');
      basis = s.basis;
      render({ keepServing: true });
    },
  }) : null;
  const unitChips = chips({
    label: 'Unit',
    options: [{ value: 'g', label: 'Grams' }, { value: 'ml', label: 'Millilitres' }],
    value: unit,
    onChange: (v) => { unit = v; basis = 'typed'; servingChips?.set(null); render({ keepServing: true }); },
  });

  const keypad = h('div', { class: 'keypad' }, KEYS.map((k) => (k ? h('button', {
    type: 'button', class: 'key', 'aria-label': k === 'back' ? 'Delete' : k, onclick: () => press(k),
  }, k === 'back' ? '⌫' : k) : h('span'))));

  const gramsNow = () => {
    const n = typedGrams(text);
    if (n == null) return null;
    return unit === 'ml' ? mlToGrams(n, food.gramsPer100ml ?? 100) : n;
  };

  function press(k) {
    text = pressGramsKey(text, k);
    basis = 'typed';
    render();
  }

  function render({ keepServing = false } = {}) {
    if (!keepServing) servingChips?.set(servings.find((s) => String(s.grams) === text && unit === 'g' && basis === s.basis)?.value ?? null);
    num.textContent = text || '0';
    num.classList.toggle('placeholder', !text);
    unitLabel.textContent = unit;
    const g = gramsNow();
    const ok = g != null && g <= MAX_GRAMS;
    const amounts = ok ? amountsFor(food.per100g, g, food) : null;
    const estimated = food.source === 'estimate' || basis === 'guessed';
    figures.textContent = amounts
      ? keepUnits(`${unit === 'ml' ? `${formatGrams(g)}: ` : ''}${figuresText(amounts, { estimated })}`)
      : 'Enter the grams, or pick a portion.';
    fill(notes,
      food.source === 'estimate' && h('p', { class: 'warning' }, `~ Estimated nutrition.${food.assumptions ? ` ${food.assumptions}` : ''}`),
      basis === 'guessed' && h('p', { class: 'warning' }, '~ Portion guessed. Change the grams if you know them.'),
      amounts && unknownLines(sumAmounts([amounts])).map((l) => h('p', { class: 'reason' }, l)));
    button.disabled = busy || !ok;
    button.textContent = !ok ? (g > MAX_GRAMS ? 'Enter up to 5,000 g' : 'Enter the Grams') : `${titleCase(verb)} ${formatGrams(g)}`;
  }

  async function done() {
    const g = gramsNow();
    if (busy || g == null || g > MAX_GRAMS) return;
    busy = true;
    render({ keepServing: true });
    const kept = await onDone({ grams: g, portionBasis: basis ?? 'typed' });
    busy = false;
    if (kept === false) render({ keepServing: true });
    else s.close();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
    else if (e.key === 'Enter' && !e.target.closest?.('button')) { e.preventDefault(); done(); }
  }

  const s = openSheet({ title: food.name, onClose: () => document.removeEventListener('keydown', onKey) },
    h('div', { class: 'sheet-form' },
      servingChips,
      display,
      figures,
      unitChips,
      keypad,
      notes,
      h('div', { class: 'sheet-actions' }, button)));
  document.addEventListener('keydown', onKey);
  render();
  return s;
}
