// Settings, for now: the backend connection and the daily target, so Log can be used. Goal, mode,
// floor, meal times, units, sources, backup and export come with Stage 6.

import { h, fill, field, toast } from './dom.js';
import { runAction } from './format.js';
import { today, targetRowFor, formatKcal, syncedPhrase } from '../engine/index.js';

const whole = (input) => (/^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : null);

export function renderSettings(root, { repo, onConnected }) {
  const S = repo.state;
  const view = h('div', { class: 'screen' });
  fill(root, view);

  function render() {
    const address = h('input', { class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: S.connection?.apiBase ?? '', placeholder: 'https://mateen-foodey.example.workers.dev' });
    const token = h('input', { class: 'input', type: 'password', autocomplete: 'off', value: S.connection?.token ?? '' });
    const connect = h('button', {
      type: 'button', class: 'button primary',
      onclick: async () => {
        connect.disabled = true;
        const ok = await runAction(() => repo.connect({ apiBase: address.value, token: token.value }));
        connect.disabled = false;
        if (ok !== null) { toast('Connected. Everything is synced.'); onConnected?.(); render(); }
      },
    }, repo.connected() ? 'Connect Again' : 'Connect');

    const current = targetRowFor(S.targets, today());
    const kcal = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: current?.kcal ?? '', autocomplete: 'off' });
    const protein = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: current?.proteinG ?? '', placeholder: 'Optional', autocomplete: 'off' });
    const save = h('button', {
      type: 'button', class: 'button primary', disabled: !repo.connected(),
      onclick: async () => {
        const k = whole(kcal);
        if (!k) return toast('Enter a daily target in kcal.');
        const date = today();
        const row = { fromDate: date, mode: current?.mode ?? 'fixed', kcal: k, proteinG: whole(protein), carbsG: current?.carbsG ?? null, fatG: current?.fatG ?? null, goalRateG: current?.goalRateG ?? null, deletedAt: null };
        const ok = await runAction(() => repo.saveRow('targets', date, row));
        if (ok) toast(`Target set: ${formatKcal(k)} a day from today.`);
      },
    }, 'Save Target');

    fill(view,
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Backend'),
        field('Address', address),
        field('Token', token, 'The API token you set on the Worker.'),
        connect,
        repo.connected() && h('p', { class: 'reason' }, `${syncedPhrase(S.lastSyncedAt)}.`)),
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Daily Target'),
        h('div', { class: 'row-2' }, field('Kcal', kcal), field('Protein g', protein)),
        h('p', { class: 'reason' }, 'Applies from today. Past days keep the target they had.'),
        save));
  }

  render();
  return { refresh: () => { if (!view.contains(document.activeElement)) render(); } };
}
