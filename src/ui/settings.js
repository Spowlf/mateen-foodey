// Settings: goal, mode and targets (from today, so past days keep theirs); the floor and exercise
// added back; meal times; weight units; food sources; backup, restore and CSV; the backend; and an
// update check. Small settings save as soon as they change; the target saves with its button.

import { h, fill, field, chips, toast } from './dom.js';
import { runAction, offlineLabel, keepUnits } from './format.js';
import { exportBackup, exportCsv, importBackup } from './backup.js';
import { ApiError } from '../errors.js';
import {
  today, targetRowFor, targetFromSettings, settingProblem, typedWhole, maintenanceEstimate, adaptiveKcal, dailyChangeKcal,
  formatKcal, syncedPhrase, goalPhrase, TIMED_MEALS, mealName, DEFAULT_SETTINGS, GOAL_RATES_G, DEFAULT_FLOOR_KCAL,
  SGFOODID_ACCESSED, SGFOODID_TERMS, formatDay,
} from '../engine/index.js';

const GOALS = { '-750': 'Lose 0.75 kg', '-500': 'Lose 0.5 kg', '-250': 'Lose 0.25 kg', 0: 'Maintain', 250: 'Gain 0.25 kg' };
const SOURCES = [
  ['off', 'Open Food Facts', 'Packaged UK foods and barcodes.'],
  ['cofid', 'CoFID', 'The UK government’s food tables.'],
  ['sgfoodid', 'SG FoodID', 'Singapore’s food tables, for its dishes and drinks.'],
  ['usda', 'USDA', 'The US food tables, for what the others lack.'],
];

const numberInput = (attrs) => h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'done', ...attrs });

/** Asks the service worker for new app files and reloads if there are any. */
function checkForUpdate() {
  if (!navigator.serviceWorker?.controller) return toast('The app isn’t installed for offline use here, so it’s always the latest.');
  const channel = new MessageChannel();
  channel.port1.onmessage = (e) => {
    if (e.data?.changed) location.reload();
    else toast(e.data?.reached ? 'You have the latest version.' : 'The app’s files couldn’t be reached. Try again online.');
  };
  navigator.serviceWorker.controller.postMessage({ type: 'check' }, [channel.port2]);
}

export function renderSettings(root, { repo, onConnected }) {
  const S = repo.state;
  const view = h('div', { class: 'screen' });
  fill(root, view);

  const setting = (id) => repo.setting(id, DEFAULT_SETTINGS[id]);

  /** Saves one setting after checking it, saying what to do if it can't be used. */
  async function saveSetting(id, value, done) {
    const problem = settingProblem(id, value);
    if (problem) { toast(`Nothing changed: ${problem}`); render(); return; }
    const ok = await runAction(() => repo.setSetting(id, value));
    if (ok) toast(done);
    else render();
  }

  function targetSection() {
    const now = today();
    const current = targetRowFor(S.targets, now);
    const floorKcal = setting('floorKcal');
    const estimate = maintenanceEstimate({ entries: S.entries, days: S.days, weights: S.weights, end: now });
    let goal = current?.goalRateG ?? -500;
    let mode = current?.mode ?? 'fixed';
    const kcal = numberInput({ value: current?.kcal ?? '', oninput: () => update() });
    const protein = numberInput({ value: current?.proteinG ?? '', oninput: () => update() });
    const carbs = numberInput({ value: current?.carbsG ?? '', placeholder: 'Optional', oninput: () => update() });
    const fat = numberInput({ value: current?.fatG ?? '', placeholder: 'Optional', oninput: () => update() });
    const kcalField = field('Daily kcal', kcal);
    const how = h('p', { class: 'reason', 'aria-live': 'polite' });
    const problem = h('p', { class: 'warning', 'aria-live': 'polite' });
    const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });
    const goalChips = chips({ label: 'Goal a Week', options: GOAL_RATES_G.map((g) => ({ value: g, label: GOALS[g] })), value: goal, onChange: (v) => { goal = v; update(); } });
    const modeChips = chips({ label: 'Mode', options: [{ value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' }], value: mode, onChange: (v) => { mode = v; update(); } });

    const read = () => targetFromSettings({ fromDate: now, mode, kcalText: kcal.value, proteinText: protein.value, carbsText: carbs.value, fatText: fat.value, goalRateG: goal, estimate, floorKcal });

    function update() {
      const fromEstimate = mode === 'adaptive' && estimate.ok;
      kcalField.hidden = fromEstimate;
      if (mode === 'fixed') {
        how.textContent = `A target you set. A share of each day’s exercise is added back. Aim it ${goalPhrase(goal)}.`;
      } else if (fromEstimate) {
        const change = dailyChangeKcal(goal);
        const target = adaptiveKcal({ maintenanceKcal: estimate.kcal, goalRateG: goal, floorKcal });
        const floored = target > estimate.kcal + change ? ` That’s under your floor, so it’s held at ${formatKcal(floorKcal)}.` : '';
        how.textContent = keepUnits(`${formatKcal(target)} a day: the ~${formatKcal(estimate.kcal)} estimate${change ? ` ${change < 0 ? 'less' : 'plus'} ${formatKcal(Math.abs(change))}` : ''}, ${goalPhrase(goal)}.${floored} After this, it changes only when you accept a new one in the weekly review.`);
      } else {
        how.textContent = `Adaptive follows your maintenance estimate once it’s ready. ${estimate.text} Until then it uses the kcal you type.`;
      }
      const r = read();
      problem.hidden = !r.error;
      problem.textContent = r.error ?? '';
      const blocked = offlineLabel(repo);
      save.disabled = !!blocked || !!r.error;
      save.textContent = blocked ?? (r.row ? `Save ${formatKcal(r.row.kcal)} from Today` : 'Save Target');
    }

    async function submit() {
      const r = read();
      if (r.error) return;
      const ok = await runAction(() => repo.saveRow('targets', r.row.id, r.row));
      if (ok) toast(keepUnits(`Target set: ${formatKcal(r.row.kcal)} a day from today.`));
    }

    update();
    return h('section', { class: 'section', 'aria-label': 'Goal and Target' },
      h('h2', { class: 'subhead' }, 'Goal and Target'),
      field('Goal a Week', goalChips),
      field('Mode', modeChips),
      how,
      kcalField,
      h('div', { class: 'row-3' }, field('Protein g', protein), field('Carbs g', carbs), field('Fat g', fat)),
      h('p', { class: 'reason' }, 'Applies from today. Past days keep the target they had.'),
      problem,
      save);
  }

  function limitsSection() {
    const floor = numberInput({ value: setting('floorKcal') });
    const addBack = numberInput({ value: setting('exerciseAddBackPct') });
    floor.addEventListener('change', () => saveSetting('floorKcal', typedWhole(floor.value), `Floor saved: ${formatKcal(typedWhole(floor.value) ?? 0)}.`));
    addBack.addEventListener('change', () => saveSetting('exerciseAddBackPct', typedWhole(addBack.value), `Saved: ${typedWhole(addBack.value)}% of exercise added back.`));
    return h('section', { class: 'section', 'aria-label': 'Floor and Exercise' },
      h('h2', { class: 'subhead' }, 'Floor and Exercise'),
      h('div', { class: 'row-2' },
        field('Floor kcal', floor),
        field('Exercise Added Back %', addBack)),
      h('p', { class: 'reason' }, keepUnits(`A target never goes below the floor (${formatKcal(DEFAULT_FLOOR_KCAL)} to start). In fixed mode, this share of each day’s exercise is added to the target; adaptive adds none, since the estimate already counts it.`)));
  }

  function mealsSection() {
    const times = { ...DEFAULT_SETTINGS.mealTimes, ...setting('mealTimes') };
    const inputs = Object.fromEntries(TIMED_MEALS.map((m) => [m, h('input', { class: 'input', type: 'time', value: times[m] })]));
    for (const input of Object.values(inputs)) {
      input.addEventListener('change', () => saveSetting('mealTimes', Object.fromEntries(TIMED_MEALS.map((m) => [m, inputs[m].value])), 'Meal times saved.'));
    }
    return h('section', { class: 'section', 'aria-label': 'Meal Times' },
      h('h2', { class: 'subhead' }, 'Meal Times'),
      h('div', { class: 'row-3' }, TIMED_MEALS.map((m) => field(`${mealName(m)} From`, inputs[m]))),
      h('p', { class: 'reason' }, 'Log picks breakfast, lunch or dinner from the time. Snacks you pick yourself, any time of day. You can change the meal on every entry.'));
  }

  function unitsSection() {
    return h('section', { class: 'section', 'aria-label': 'Weight Units' },
      h('h2', { class: 'subhead' }, 'Weight Units'),
      chips({
        label: 'Weight Units', options: [{ value: 'kg', label: 'kg' }, { value: 'stlb', label: 'st lb' }], value: setting('weightUnit'),
        onChange: (v) => saveSetting('weightUnit', v, v === 'kg' ? 'Weights show in kg.' : 'Weights show in stones and pounds.'),
      }));
  }

  function sourcesSection() {
    const on = { ...DEFAULT_SETTINGS.sources, ...setting('sources') };
    return h('section', { class: 'section', 'aria-label': 'Food Sources' },
      h('h2', { class: 'subhead' }, 'Food Sources'),
      h('div', { class: 'list toggles' }, SOURCES.map(([id, name, hint]) => h('label', { class: 'toggle-row' },
        h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, name), h('span', { class: 'list-sub' }, hint)),
        h('input', {
          type: 'checkbox', checked: on[id],
          onchange: (e) => saveSetting('sources', { ...on, [id]: e.target.checked }, `${name} ${e.target.checked ? 'is on' : 'is off'}.`),
        })))),
      h('p', { class: 'reason' }, 'Searches and sentence logging use the sources that are on. Your own foods are always searched first.'),
      // SG FoodID's licence asks for this notice, with a link to its terms.
      h('p', { class: 'reason' }, `Contains information from the Singapore Food Insights Database, SG FoodID, accessed on ${formatDay(SGFOODID_ACCESSED)} from the Health Promotion Board and made available under its terms. It’s provided as is, with no warranty that it’s accurate or complete.`),
      h('div', {}, h('a', { class: 'text-button', href: SGFOODID_TERMS, target: '_blank', rel: 'noopener noreferrer' }, 'SG FoodID Terms')));
  }

  function backupSection() {
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { const f = file.files?.[0]; file.value = ''; if (f) importBackup(repo, f); } });
    return h('section', { class: 'section', 'aria-label': 'Backup' },
      h('h2', { class: 'subhead' }, 'Backup'),
      h('p', { class: 'reason' }, 'A backup holds everything, deleted records too. Restoring one replaces everything on your backend, all or nothing.'),
      h('div', { class: 'link-row' },
        h('button', { type: 'button', class: 'text-button', disabled: !repo.connected(), onclick: () => exportBackup(repo) }, 'Save a Backup'),
        h('button', { type: 'button', class: 'text-button', disabled: !repo.connected(), onclick: () => file.click() }, 'Restore a Backup'),
        h('button', { type: 'button', class: 'text-button', onclick: () => exportCsv(repo) }, 'Export as CSV')),
      file);
  }

  function backendSection() {
    const connected = repo.connected();
    const start = S.connection ?? S.connectionDraft ?? {};
    const keep = () => {
      update();
      // Only before connecting: afterwards the saved connection is what counts.
      if (!connected) repo.saveConnectionDraft({ apiBase: address.value, token: token.value }).catch(() => {});
    };
    const address = h('input', { class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: start.apiBase ?? '', placeholder: 'mateen-foodey.example.workers.dev', oninput: keep });
    // Not a password field: Safari's AutoFill matches saved passwords by site, and Mateen Money on the
    // same github.io site has its own token, which it would offer here. Masked by CSS instead.
    const token = h('input', {
      class: 'input masked', type: 'text', id: 'api-token', name: 'mateen-foodey-api-token', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      spellcheck: 'false', 'data-1p-ignore': true, 'data-lpignore': 'true', value: start.token ?? '', oninput: keep,
      // A tap selects the whole token, so a paste replaces it instead of joining an old one hidden behind the dots.
      onfocus: () => setTimeout(() => token.select(), 0),
    });
    const showToken = h('button', { type: 'button', class: 'text-button', 'aria-pressed': 'false', onclick: () => {
      const shown = token.classList.toggle('masked') === false;
      showToken.setAttribute('aria-pressed', String(shown));
      showToken.textContent = shown ? 'Hide' : 'Show';
    } }, 'Show');
    const tokenHint = h('span', { class: 'field-hint', 'aria-live': 'polite' });
    let busy = false;
    const connect = h('button', {
      type: 'button', class: connected ? 'text-button' : 'button primary',
      onclick: async () => {
        busy = true;
        update();
        let ok = null;
        try {
          ok = await repo.connect({ apiBase: address.value, token: token.value });
        } catch (err) {
          const t = token.value.trim();
          // The backend refused the token: say what was sent, so a wrong or doubled paste shows.
          if (err instanceof ApiError && err.status === 401) toast(`Nothing changed: the backend refused this token (${t.length} characters, ending in “${t.slice(-4)}”). Check that matches your Mac, then tap the field and paste it again.`);
          else await runAction(() => { throw err; });
        }
        busy = false;
        update();
        if (ok !== null) { toast('Connected. Everything is synced.'); onConnected?.(); render(); }
      },
    });
    function update() {
      const t = token.value.trim();
      // Enough to compare with the Mac's copy without showing the whole token.
      tokenHint.textContent = t ? `${t.length} characters, ending in “${t.slice(-4)}”.` : 'Copy it on the Mac and paste it here: the clipboard is shared between your devices.';
      const missing = !address.value.trim() ? 'Enter the Address' : !t ? 'Enter the Token' : null;
      connect.disabled = busy || !!missing;
      connect.textContent = busy ? 'Connecting' : missing ?? (connected ? 'Connect Again' : 'Connect');
    }
    update();
    return h('section', { class: 'section', 'aria-label': 'Backend' },
      h('h2', { class: 'subhead' }, 'Backend'),
      field('Address', address),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'api-token' }, 'Token'),
        h('div', { class: 'add-box' }, token, showToken),
        tokenHint),
      connected ? h('div', {}, connect) : connect,
      connected && h('p', { class: 'reason' }, `${syncedPhrase(S.lastSyncedAt)}.`));
  }

  function appSection() {
    return h('section', { class: 'section', 'aria-label': 'App' },
      h('h2', { class: 'subhead' }, 'App'),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: checkForUpdate }, 'Check for Updates')));
  }

  function render() {
    if (!repo.connected()) return fill(view, backendSection(), backupSection(), appSection());
    fill(view, targetSection(), limitsSection(), mealsSection(), unitsSection(), sourcesSection(), backupSection(), backendSection(), appSection());
  }

  render();
  return { refresh: () => { if (!view.contains(document.activeElement)) render(); } };
}
