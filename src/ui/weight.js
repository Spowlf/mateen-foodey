// Weight: the trend first, then the latest reading; Add Weight; the chart (1 Month / 3 Months / All)
// with "Show as a Table"; then the maintenance estimate and the target, each with how it's counted.

import { h, fill, field, segmented, openSheet, toast } from './dom.js';
import { runAction, deleteWithUndo, offlineLabel } from './format.js';
import { weightChart } from './charts.js';
import {
  today, trendOn, lastReading, rangeStart, weightPoints, trendChangeText, formatWeight, formatDay, weightFromText, weightText,
  maintenanceEstimate, targetRowFor, targetText, isLive,
} from '../engine/index.js';

// The chart's range is kept while you move between tabs.
let range = '1m';

const unitOf = (repo) => repo.setting('weightUnit') ?? 'kg';

/** Adds or changes the reading for a day (one a day: saving a day again replaces it). */
export function openWeightSheet({ repo, date: startDate = today() }) {
  const unit = unitOf(repo);
  let busy = false;
  const existing = (date) => repo.state.weights.find((w) => isLive(w) && w.id === date) ?? null;
  const input = (attrs) => h('input', { class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', oninput: () => render(), ...attrs });
  const kg = input({ placeholder: '72.4' });
  const st = input({ inputmode: 'numeric', placeholder: '11' });
  const lb = input({ placeholder: '6' });
  const date = h('input', { class: 'input', type: 'date', value: startDate, max: today(), oninput: () => { prefill(); render(); } });
  const note = h('p', { class: 'reason', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });
  const remove = h('button', { type: 'button', class: 'text-button danger', onclick: () => removeReading() }, 'Delete Reading');

  function prefill() {
    const w = existing(date.value);
    const text = w ? weightText(w.grams, unit) : {};
    kg.value = text.kg ?? '';
    st.value = text.st ?? '';
    lb.value = text.lb ?? '';
  }

  const read = () => weightFromText({ unit, kg: kg.value, st: st.value, lb: lb.value });
  const blank = () => (unit === 'stlb' ? !st.value.trim() && !lb.value.trim() : !kg.value.trim());

  function render() {
    const w = existing(date.value);
    const result = read();
    const blocked = offlineLabel(repo);
    note.textContent = w ? `Replaces the ${formatWeight(w.grams, unit)} saved for ${date.value === today() ? 'today' : formatDay(date.value)}.` : '';
    note.hidden = !w;
    remove.hidden = !w;
    save.disabled = busy || !!blocked || !!result.error || !date.value;
    save.textContent = busy ? 'Saving' : blocked ?? (blank() ? 'Enter Your Weight' : result.error ? 'Check the Weight' : `Save ${formatWeight(result.grams, unit)}`);
    err.hidden = blank() || !result.error;
    err.textContent = result.error ?? '';
  }
  const err = h('p', { class: 'warning', 'aria-live': 'polite' });

  async function submit() {
    const result = read();
    if (busy || result.error || !date.value) return;
    busy = true;
    render();
    const d = date.value;
    const ok = await runAction(() => repo.saveRow('weights', d, { date: d, grams: result.grams, source: 'manual', deletedAt: null }));
    busy = false;
    if (!ok) return render();
    s.close();
    toast(`Saved ${formatWeight(result.grams, unit)} for ${d === today() ? 'today' : formatDay(d)}.`);
  }

  async function removeReading() {
    const w = existing(date.value);
    if (!w) return;
    if (await deleteWithUndo(repo, 'weights', { id: w.id, name: `the reading for ${w.date === today() ? 'today' : formatDay(w.date)}` })) s.close();
  }

  const s = openSheet({ title: 'Add Weight' },
    h('div', { class: 'sheet-form' },
      unit === 'stlb' ? h('div', { class: 'row-2' }, field('Stones', st), field('Pounds', lb)) : field('Weight kg', kg),
      err,
      field('Date', date),
      note,
      h('div', { class: 'sheet-actions' }, save, h('div', {}, remove))));
  prefill();
  render();
  (unit === 'stlb' ? st : kg).focus();
  return s;
}

export function renderWeight(root, { repo }) {
  const S = repo.state;
  const view = h('div', { class: 'screen' });
  fill(root, view);

  function render() {
    const now = today();
    const unit = unitOf(repo);
    const trend = trendOn(S.weights, now);
    const last = lastReading(S.weights, now);
    const add = h('button', { type: 'button', class: 'button primary', disabled: !!offlineLabel(repo), onclick: () => openWeightSheet({ repo }) }, offlineLabel(repo) ?? 'Add Weight');

    const settings = { floorKcal: repo.setting('floorKcal') ?? undefined, exerciseAddBackPct: repo.setting('exerciseAddBackPct') ?? undefined };
    const estimate = maintenanceEstimate({ entries: S.entries, days: S.days, weights: S.weights, end: now });
    const counted = h('section', { class: 'section', 'aria-label': 'Maintenance and Target' },
      h('h2', { class: 'subhead' }, 'Maintenance'),
      h('p', {}, estimate.text),
      !estimate.ok && h('p', { class: 'reason' }, 'The estimate needs 14 complete days and 8 weigh-ins in the last 28 days.'),
      h('h2', { class: 'subhead' }, 'Target'),
      h('p', {}, targetText(targetRowFor(S.targets, now), settings)));

    if (trend == null) {
      return fill(view,
        h('section', { class: 'empty' },
          h('h2', {}, 'No weigh-ins yet'),
          h('p', {}, 'Your trend smooths out the day-to-day swings. Add a weight, or let the Health Shortcut send it each morning.'),
          add),
        counted);
    }

    const from = rangeStart(range, now, S.weights);
    const points = weightPoints(S.weights, from, now);
    const rangeControl = segmented({
      label: 'Range',
      options: [{ value: '1m', label: '1 Month' }, { value: '3m', label: '3 Months' }, { value: 'all', label: 'All' }],
      value: range,
      onChange: (v) => { range = v; render(); },
    });
    const change = trendChangeText(points, unit);
    const readingLine = last.date === now ? `Today’s reading: ${formatWeight(last.grams, unit)}.` : `Last reading: ${formatWeight(last.grams, unit)} on ${formatDay(last.date)}.`;

    fill(view,
      h('div', { class: 'headline' },
        h('p', { class: 'headline-figure', 'aria-label': `Trend weight ${formatWeight(trend, unit)}.` },
          h('span', { class: 'num' }, formatWeight(trend, unit).replace(/ (kg|lb)$/, '')), h('span', { class: 'unit' }, `${unit === 'stlb' ? 'lb' : 'kg'} trend`)),
        h('p', { class: 'headline-protein' }, readingLine),
        h('p', { class: 'reason' }, 'The trend smooths out water and food from day to day, so it moves only when your weight really does.')),
      add,
      h('section', { class: 'section', 'aria-label': 'Chart' },
        rangeControl,
        points.length > 1 ? weightChart(points, { unit, name: range === 'all' ? 'all readings' : `the last ${range === '1m' ? 'month' : '3 months'}` })
          : h('p', { class: 'empty-line' }, 'Weigh in on another day to see a chart.'),
        change && h('p', { class: 'reason' }, change)),
      counted);
  }

  render();
  return { refresh: () => render() };
}
