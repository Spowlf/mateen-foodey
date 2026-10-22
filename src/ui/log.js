// Log: the headline and protein, To check, quick log, then one box for what you ate. A sentence goes
// to the check sheet; a food's name searches your foods and the sources; a barcode's digits look it
// up; the camera reads a photo. Quick Add takes typed kcal.
// What's typed and the check sheet's items are the one offline draft ("Not synced"): kept on every
// edit, cleared only once the backend has the entries.

import { h, fill, chips, toast, icon } from './dom.js';
import { runAction, keepUnits } from './format.js';
import { renderHeadline } from './headline.js';
import { createFoodSearch } from './food-search.js';
import { openGramsSheet } from './grams-sheet.js';
import { openCheckSheet } from './check-sheet.js';
import { openQuickAdd } from './quick-add.js';
import { photoForParse } from './photo.js';
import { submitDraft } from '../db/drafts.js';
import { OfflineError } from '../errors.js';
import {
  today, nowTime, mealForTime, MEALS, mealName, emptyLogForm, isBlank, quickLogFoods, toCheckEntries, amountsFor,
  formatGrams, formatDayShort, titleCase, kcalOf, formatKcal,
} from '../engine/index.js';

const TO_CHECK_SHOWN = 3;
const BARCODE = /^\d{8,14}$/;
// A short name searches as you type; a longer sentence waits for Check Items.
const searchable = (text) => text.trim() && !/[,;]/.test(text) && text.trim().split(/\s+/).length <= 4 && !BARCODE.test(text.trim());

export function renderLog(root, { repo }) {
  const S = repo.state;
  const el = {
    headline: h('section', { 'aria-live': 'polite', 'aria-label': 'Today' }),
    toCheck: h('section', { class: 'section', 'aria-label': 'To Check' }),
    quick: h('section', { class: 'section', 'aria-label': 'Quick Log' }),
    add: h('section', { class: 'add', 'aria-label': 'Log Food' }),
  };
  fill(root, h('div', { class: 'screen' }, el.headline, el.toCheck, el.quick, el.add));

  let form = null;
  let busy = false;
  let showAllToCheck = false;
  let offline = !navigator.onLine;

  const mealNow = () => mealForTime(nowTime(), repo.setting('mealTimes') ?? undefined);
  const freshForm = () => ({ ...emptyLogForm({ id: crypto.randomUUID(), date: today(), meal: mealNow() }), origin: 'sentence', mealPicked: false });
  const keep = () => repo.draft.save(form).catch(() => {});
  const meal = () => (form?.mealPicked ? form.meal : mealNow());

  // To check

  function checkRow(entry) {
    const food = S.foods.find((f) => f.id === entry.foodId);
    const kcal = kcalOf(entry.nutrition.kcalMilli);
    const sub = [
      entry.grams && formatGrams(entry.grams),
      kcal != null && `~${formatKcal(kcal)}`,
      entry.meal,
      entry.date !== today() && formatDayShort(entry.date),
    ].filter(Boolean).join(', ');
    const confirm = (changes = {}) => runAction(async () => {
      await repo.saveRow('entries', entry.id, { status: 'logged', ...changes });
      toast(`Confirmed ${entry.name}.`);
    });
    return h('li', { class: 'check-row' },
      h('button', {
        type: 'button', class: 'list-row', disabled: !food,
        onclick: () => openGramsSheet({
          food, grams: entry.grams, portionBasis: entry.portionBasis, verb: 'Confirm',
          onDone: async ({ grams, portionBasis }) => {
            // The same food the Shortcut matched, weighed again: its nutrition for the grams you confirm.
            const changes = grams === entry.grams ? {} : { grams, portionBasis, nutrition: amountsFor(food.per100g, grams, food) };
            return (await confirm(changes)) !== null;
          },
        }),
      },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, entry.name),
        h('span', { class: 'list-sub' }, keepUnits(sub)))),
      h('button', { type: 'button', class: 'text-button', 'aria-label': `Confirm ${entry.name}`, onclick: () => confirm() }, 'Confirm'));
  }

  function renderToCheck() {
    const items = toCheckEntries(S.entries);
    el.toCheck.hidden = !items.length;
    if (!items.length) return fill(el.toCheck);
    const shown = showAllToCheck ? items : items.slice(0, TO_CHECK_SHOWN);
    fill(el.toCheck,
      h('h2', { class: 'subhead' }, 'To Check', h('span', { class: 'tag' }, items.length)),
      h('p', { class: 'reason' }, 'Saved by a Shortcut. They count in today as estimates until you confirm them.'),
      h('ul', { class: 'list' }, shown.map(checkRow)),
      items.length > shown.length && h('div', {},
        h('button', { type: 'button', class: 'text-button', onclick: () => { showAllToCheck = true; renderToCheck(); } }, `Show ${items.length - shown.length} More`)));
  }

  // Logging, with Undo

  async function logged(entries, { restore = null } = {}) {
    const n = entries.length;
    // A food's name keeps its own case: it's a name.
    const what = n === 1 ? `${entries[0].grams ? `${formatGrams(entries[0].grams)} ` : ''}${entries[0].name}` : `${n} items`;
    toast(`Logged ${what} to ${entries[0] ? mealName(entries[0].meal).toLowerCase() : 'today'}.`, {
      label: 'Undo',
      run: () => runAction(async () => {
        await repo.deleteEntries(entries.map((e) => e.id));
        if (restore) { form = { ...restore, id: crypto.randomUUID() }; keep(); renderAdd(); }
        toast('Removed.');
      }),
    });
  }

  async function logOne(food, grams, portionBasis) {
    const entries = await runAction(() => repo.logLines({ lines: [{ food, grams, portionBasis }], date: today(), meal: meal(), origin: 'manual' }));
    if (!entries) return false;
    logged(entries);
    return true;
  }

  // Quick log

  function renderQuick() {
    const items = repo.connected() ? quickLogFoods({ entries: S.entries, foods: S.foods, meal: meal(), today: today() }) : [];
    el.quick.hidden = !items.length;
    if (!items.length) return fill(el.quick);
    fill(el.quick, h('div', { class: 'chips', role: 'group', 'aria-label': `Quick log to ${mealName(meal()).toLowerCase()}` },
      items.map(({ food, grams }) => h('button', {
        type: 'button', class: 'chip', 'aria-label': `Log ${formatGrams(grams)} ${food.name}`,
        onclick: (e) => { e.currentTarget.disabled = true; logOne(food, grams, 'typed').finally(() => renderQuick()); },
      }, food.name, h('span', { class: 'chip-sub' }, formatGrams(grams))))));
  }

  // The add box

  const mealChips = chips({
    label: 'Meal',
    className: 'fit',
    options: MEALS.map((m) => ({ value: m, label: mealName(m) })),
    value: null,
    onChange: (m) => { form = { ...form, meal: m, mealPicked: true }; keep(); renderQuick(); renderAdd(); },
  });
  const box = h('textarea', {
    class: 'input', rows: 1, autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'go',
    'aria-label': 'What you ate', placeholder: 'Two eggs, toast with butter, flat white',
    oninput: () => {
      // Changing the words means the items read from them no longer fit.
      form = { ...form, text: box.value, lines: [], origin: 'sentence' };
      keep();
      renderAdd();
    },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } },
  });
  const photoInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => readPhoto() });
  const photoButton = h('button', { type: 'button', class: 'icon-button boxed', 'aria-label': 'Log from a Photo', onclick: () => photoInput.click() }, icon('camera'));
  const notSynced = h('p', { class: 'not-synced' }, h('span', { class: 'tag tag-quiet' }, 'Not synced'), h('span', {}, 'Kept on this phone until you’re back online.'));
  const checkButton = h('button', { type: 'button', class: 'button primary', onclick: () => check() });
  const quickAdd = h('button', { type: 'button', class: 'text-button', onclick: () => openQuickAdd({ repo, date: today(), meal: meal() }) }, 'Quick Add');
  const barcodeRow = () => {
    const code = form?.text.trim();
    if (!code || !BARCODE.test(code)) return [];
    return [h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => lookUpBarcode(code) }, titleCase(`look up barcode ${code}`)))];
  };
  const results = createFoodSearch({
    repo,
    extra: barcodeRow,
    onPick: (food) => openGramsSheet({
      food, grams: food.usualGrams ?? null, verb: 'Log',
      onDone: async ({ grams, portionBasis }) => {
        const ok = await logOne(food, grams, portionBasis);
        if (ok) { form = freshForm(); keep(); renderAdd(); results.clear(); }
        return ok;
      },
    }),
  });

  fill(el.add, mealChips, h('div', { class: 'add-box' }, box, photoButton), photoInput, notSynced,
    h('div', { class: 'add-actions' }, checkButton, quickAdd), results.el);

  function renderAdd() {
    if (!form) return;
    mealChips.set(meal());
    if (box.value !== form.text) box.value = form.text;
    const blank = isBlank(form);
    const connected = repo.connected();
    notSynced.hidden = !(offline && !blank);
    const n = form.lines.length;
    checkButton.disabled = busy || !connected || offline || (!form.text.trim() && !n) || BARCODE.test(form.text.trim());
    checkButton.textContent = busy ? 'Reading What You Ate'
      : !connected ? 'Connect to Log'
        : offline ? 'Needs a Connection'
          : n ? titleCase(`check ${n} ${n === 1 ? 'item' : 'items'}`)
            : form.text.trim() ? 'Check Items' : 'Type What You Ate';
    photoButton.disabled = busy || !connected || offline;
    quickAdd.disabled = !connected;
    if (searchable(form.text) || BARCODE.test(form.text.trim())) results.search(form.text);
    else results.clear();
  }

  // Sentence and photo logging

  const toLines = (items) => items.map((it) => ({
    name: it.name, food: it.food, grams: it.grams, portionBasis: it.portionBasis, alternatives: it.alternatives ?? [],
    state: it.state, searchTerm: it.searchTerm, matchedFrom: it.matchedFrom,
  }));

  async function parse(body, origin) {
    if (busy) return;
    busy = true;
    renderAdd();
    let data = null;
    try {
      data = await repo.parse(body);
    } catch (err) {
      toast(err instanceof OfflineError ? 'You’re offline. What you typed is kept here.' : err.message);
    }
    busy = false;
    if (data) {
      form = { ...form, lines: toLines(data.items), origin };
      keep();
      if (data.callsLeft <= 10) toast(`${data.callsLeft} sentence ${data.callsLeft === 1 ? 'log' : 'logs'} left today.`);
      openSheetForForm();
    }
    renderAdd();
  }

  function check() {
    if (!form || busy) return;
    if (form.lines.length) return openSheetForForm();
    if (form.text.trim() && !BARCODE.test(form.text.trim())) parse({ text: form.text }, 'sentence');
  }

  async function readPhoto() {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    let image;
    try {
      image = await photoForParse(file);
    } catch {
      return toast('That photo couldn’t be opened. Try another.');
    }
    parse({ image }, 'photo');
  }

  function openSheetForForm() {
    openCheckSheet({
      repo,
      lines: form.lines,
      onChange: (lines) => { form = { ...form, lines }; keep(); renderAdd(); },
      onLog: async (lines) => {
        const saving = { ...form, lines };
        const result = await submitDraft({
          form: saving,
          store: repo.draft,
          send: () => repo.logLines({ lines, date: today(), meal: meal(), origin: saving.origin ?? 'sentence' }),
        });
        if (result.status === 'saved') {
          form = freshForm();
          keep();
          renderAdd();
          logged(result.result, { restore: saving });
          return true;
        }
        toast(result.status === 'offline' ? 'You’re offline. The items are kept here: log them when you’re back online.' : result.message);
        offline = result.status === 'offline' || offline;
        renderAdd();
        return false;
      },
    });
  }

  async function lookUpBarcode(code) {
    const data = await runAction(() => repo.barcode(code));
    if (!data) return;
    if (!data.food) return toast('Nothing found for that barcode. Search by name instead.');
    results.clear();
    openGramsSheet({
      food: data.food, grams: data.food.servings?.[0]?.grams ?? null, portionBasis: data.food.servings?.length ? 'serving' : null, verb: 'Log',
      onDone: async ({ grams, portionBasis }) => {
        const ok = await logOne(data.food, grams, portionBasis);
        if (ok) { form = freshForm(); keep(); renderAdd(); }
        return ok;
      },
    });
  }

  const onNetwork = () => { offline = !navigator.onLine; renderAdd(); };
  window.addEventListener('online', onNetwork);
  window.addEventListener('offline', onNetwork);

  async function start() {
    const draft = await repo.draft.load().catch(() => null);
    form = draft ? { ...freshForm(), ...draft, lines: draft.lines ?? [] } : freshForm();
    renderQuick();
    renderAdd();
  }

  renderHeadline(el.headline, repo);
  renderToCheck();
  renderQuick();
  start();

  return {
    /** New data arrived (a sync or a save): update everything except what's being typed. */
    refresh() {
      renderHeadline(el.headline, repo);
      renderToCheck();
      renderQuick();
      renderAdd();
    },
    destroy() {
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    },
  };
}

