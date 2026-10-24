// One of your foods: where it's from and how it's used, then its name, how it's weighed, nutrition
// per 100 g as on a label (blank is unknown, never 0), servings and the weight of 100 ml.
// Saving an edit marks it as yours, so a refresh from its source never overwrites it.

import { h, fill, chips, field, openSheet, toast } from './dom.js';
import { runAction, mealNow, loggedToast, deleteWithUndo, offlineLabel, keepUnits } from './format.js';
import { openGramsSheet } from './grams-sheet.js';
import {
  per100gFromText, per100gText, servingsFromText, customFood, editedFood, today, mealName, formatGrams, titleCase, NUTRIENTS, nameCase,
} from '../engine/index.js';

const SOURCES = { off: 'Open Food Facts', cofid: 'CoFID', sgfoodid: 'SG FoodID', usda: 'USDA' };
const STATES = [{ value: 'raw', label: 'Raw' }, { value: 'cooked', label: 'Cooked' }, { value: 'asSold', label: 'As Sold' }];
const NUTRIENT_LABELS = { protein: 'Protein g', carbs: 'Carbs g', fat: 'Fat g', fibre: 'Fibre g', sugars: 'Sugars g', salt: 'Salt g' };

/** "From CoFID. Logged 12 times, usually 40 g." */
function factsLine(food) {
  const from = food.source === 'custom' ? 'Your own food.' : food.source === 'estimate' ? null : `From ${SOURCES[food.source]}${food.barcode ? `, barcode ${food.barcode}` : ''}.`;
  const used = food.useCount
    ? `Logged ${food.useCount} ${food.useCount === 1 ? 'time' : 'times'}${food.usualGrams ? `, usually ${formatGrams(food.usualGrams)}` : ''}.`
    : 'Not logged yet.';
  return keepUnits([from, used].filter(Boolean).join(' '));
}

/** Logs a food at grams you pick, to the meal slot for now, with Undo. */
export function logFood(repo, food) {
  return openGramsSheet({
    food, grams: food.usualGrams ?? null, verb: 'Log',
    onDone: async ({ grams, portionBasis }) => {
      const entries = await runAction(() => repo.logLines({ lines: [{ food, grams, portionBasis }], date: today(), meal: mealNow(repo), origin: 'manual' }));
      if (!entries) return false;
      loggedToast(repo, entries);
      return true;
    },
  });
}

/** openFoodSheet({ repo, food }): food null adds a new one. */
export function openFoodSheet({ repo, food = null }) {
  const isNew = !food;
  const text = per100gText(food?.per100g);
  let state = food?.state ?? 'asSold';
  let servingRows = (food?.servings ?? []).map((s) => ({ label: s.label, grams: String(s.grams) }));
  let busy = false;
  let problem = null;

  const input = (attrs) => h('input', { class: 'input', type: 'text', autocomplete: 'off', enterkeyhint: 'done', oninput: () => render(), ...attrs });
  const name = input({ value: food?.name ?? '', autocapitalize: 'sentences' });
  const brand = input({ value: food?.brand ?? '', autocapitalize: 'words', placeholder: 'Optional' });
  const kcal = input({ value: text.kcal, inputmode: 'decimal' });
  const nutrients = Object.fromEntries(NUTRIENTS.map((n) => [n, input({ value: text[n], inputmode: 'decimal', placeholder: 'Unknown' })]));
  const ml = input({ value: String(food?.gramsPer100ml ?? 100), inputmode: 'numeric' });
  const stateChips = chips({ label: 'Weighed', options: STATES, value: state, onChange: (v) => { state = v; render(); } });
  const servingsEl = h('div', { class: 'section' });
  const problemEl = h('p', { class: 'warning', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function renderServings() {
    fill(servingsEl,
      servingRows.length > 0 && h('div', { class: 'lines' }, servingRows.map((r, i) => h('div', { class: 'serving-row' },
        field('Name', input({ value: r.label, placeholder: '1 slice', autocapitalize: 'off', oninput: (e) => { r.label = e.target.value; render(); } })),
        field('Grams', input({ value: r.grams, inputmode: 'numeric', oninput: (e) => { r.grams = e.target.value; render(); } })),
        h('button', { type: 'button', class: 'text-button', 'aria-label': `Remove ${r.label || 'this serving'}`, onclick: () => { servingRows = servingRows.filter((_, k) => k !== i); renderServings(); render(); } }, 'Remove')))),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => { servingRows = [...servingRows, { label: '', grams: '' }]; renderServings(); render(); } }, 'Add a Serving')));
  }

  /** What would be saved, or { error }. */
  function read() {
    if (!name.value.trim()) return { error: 'Enter the food’s name.', label: 'Enter a Name' };
    const nutrition = per100gFromText({ kcal: kcal.value, ...Object.fromEntries(NUTRIENTS.map((n) => [n, nutrients[n].value])) });
    if (nutrition.error) return { error: nutrition.error, label: kcal.value.trim() ? null : 'Enter the Kcal' };
    const servings = servingsFromText(servingRows);
    if (servings.error) return { error: servings.error };
    const g = ml.value.trim();
    if (!/^\d+$/.test(g) || Number(g) < 1 || Number(g) > 300) return { error: 'Enter what 100 ml weighs, from 1 to 300 g.' };
    return { fields: { name: name.value, brand: brand.value, state, per100g: nutrition.per100g, servings: servings.servings, gramsPer100ml: Number(g) } };
  }

  function render() {
    const result = read();
    const blocked = offlineLabel(repo);
    problemEl.hidden = !(problem && result.error);
    problemEl.textContent = result.error ?? '';
    save.disabled = busy || !!blocked || !!result.label;
    save.textContent = busy ? 'Saving' : blocked ?? result.label ?? (isNew ? 'Add Food' : 'Save Changes');
  }

  async function submit() {
    const result = read();
    if (busy) return;
    if (result.error) { problem = true; return render(); }
    busy = true;
    render();
    const id = food?.id ?? crypto.randomUUID();
    const row = isNew ? customFood({ id, ...result.fields }) : editedFood(food, result.fields);
    const saved = await runAction(() => repo.saveRow('foods', id, row));
    busy = false;
    if (!saved) return render();
    s.close();
    toast(isNew ? `Added ${nameCase(row.name)}.` : `Saved ${nameCase(row.name)}.`);
  }

  const meal = mealNow(repo);
  const s = openSheet({ title: isNew ? 'Add a Food' : nameCase(food.name) },
    h('div', { class: 'sheet-form' },
      !isNew && h('div', { class: 'section' },
        h('p', { class: 'reason' }, factsLine(food)),
        food.source === 'estimate' && h('p', { class: 'warning' }, `~ Estimated nutrition.${food.assumptions ? ` ${food.assumptions}` : ''} Type the figures from a label to make it exact.`),
        food.carbsIncludeFibre ? h('p', { class: 'reason' }, 'Carbs may include fibre.') : null),
      field('Name', name),
      field('Brand', brand),
      field('Weighed', stateChips, 'Raw, cooked or as sold: log it weighed the same way.'),
      h('section', { class: 'section', 'aria-label': 'Per 100 g' },
        h('h3', { class: 'subhead' }, 'Per 100 g'),
        field('kcal', kcal),
        h('div', { class: 'row-3' }, ['protein', 'carbs', 'fat'].map((n) => field(NUTRIENT_LABELS[n], nutrients[n]))),
        h('div', { class: 'row-3' }, ['fibre', 'sugars', 'salt'].map((n) => field(NUTRIENT_LABELS[n], nutrients[n]))),
        h('p', { class: 'reason' }, 'Leave a figure blank when the label doesn’t give it. It shows as unknown, never 0.')),
      h('section', { class: 'section', 'aria-label': 'Servings' }, h('h3', { class: 'subhead' }, 'Servings'), servingsEl),
      field('Weight of 100 ml', ml, 'For drinks logged in ml. Water is 100 g.'),
      h('div', { class: 'sheet-actions' },
        problemEl,
        save,
        !isNew && h('div', { class: 'link-row' },
          h('button', { type: 'button', class: 'text-button', onclick: () => { s.close(); logFood(repo, food); } }, titleCase(`log to ${mealName(meal).toLowerCase()}`)),
          h('button', { type: 'button', class: 'text-button danger', onclick: async () => { if (await deleteWithUndo(repo, 'foods', { id: food.id, name: nameCase(food.name) })) s.close(); } }, 'Delete Food')))));
  renderServings();
  render();
  return s;
}
