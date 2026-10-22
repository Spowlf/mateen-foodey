// Quick add: typed kcal, with optional protein, carbs and fat in whole grams and an optional name.
// What isn't typed is unknown, never 0.

import { h, openSheet, field, toast } from './dom.js';
import { runAction } from './format.js';
import { quickEntry, formatKcal, mealName } from '../engine/index.js';

const whole = (input) => (/^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : null);
const box = (attrs) => h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'done', ...attrs });

/** openQuickAdd({ repo, date, meal }) */
export function openQuickAdd({ repo, date, meal }) {
  let busy = false;
  const kcal = box({ oninput: () => render() });
  const protein = box({ placeholder: 'Optional' });
  const carbs = box({ placeholder: 'Optional' });
  const fat = box({ placeholder: 'Optional' });
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', placeholder: 'Quick add' });
  const button = h('button', { type: 'button', class: 'button primary', onclick: () => save() });

  function render() {
    const k = whole(kcal);
    button.disabled = busy || !(k > 0);
    // Units keep their own case: "Log 350 kcal".
    button.textContent = k > 0 ? `Log ${formatKcal(k)}` : 'Enter the kcal';
  }

  async function save() {
    const k = whole(kcal);
    if (busy || !(k > 0)) return;
    busy = true;
    render();
    const entry = quickEntry({
      id: crypto.randomUUID(), date, meal, kcal: k, proteinG: whole(protein), carbsG: whole(carbs), fatG: whole(fat), name: name.value, createdAt: Date.now(),
    });
    const saved = await runAction(() => repo.saveRow('entries', entry.id, entry));
    busy = false;
    if (!saved) return render();
    s.close();
    toast(`Logged ${formatKcal(k)} to ${mealName(meal).toLowerCase()}.`, {
      label: 'Undo',
      run: () => runAction(async () => { await repo.deleteRow('entries', entry.id); toast('Removed.'); }),
    });
  }

  const s = openSheet({ title: 'Quick Add' }, h('div', { class: 'sheet-form' },
    field('Kcal', kcal),
    h('div', { class: 'row-3' }, field('Protein g', protein), field('Carbs g', carbs), field('Fat g', fat)),
    field('Name', name),
    h('div', { class: 'sheet-actions' }, button)));
  render();
  kcal.focus();
  return s;
}
