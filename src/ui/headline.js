// The raised panel at the top of Log: kcal left or over today, then protein to go. Over is said in
// plain ink, never red. A slim connect line until there's a backend; with no target yet, what's eaten.

import { h, fill } from './dom.js';
import { headline, targetOn, dayExercise, dayTotal, eatenLine, kcalOf, formatKcal, today, entriesOn, isEstimated } from '../engine/index.js';

// The figure last shown. It eases in only when it changes (after a log or a sync), never on every redraw.
let shownFigure = null;

const openSettings = () => document.getElementById('settings').click();

export function renderHeadline(el, repo) {
  const S = repo.state;
  if (!repo.connected()) {
    fill(el, h('div', { class: 'connect-banner' },
      h('span', {}, 'Connect to your backend to log.'),
      h('button', { type: 'button', class: 'text-button', onclick: openSettings }, 'Open Settings')));
    return;
  }
  const date = today();
  const settings = { floorKcal: repo.setting('floorKcal'), exerciseAddBackPct: repo.setting('exerciseAddBackPct') };
  const target = targetOn({ targets: S.targets, settings, activity: S.activity, workouts: S.workouts, date });
  const exercise = dayExercise({ activity: S.activity, workouts: S.workouts, date });
  const hl = headline({ entries: S.entries, date, target, exercise });

  if (!hl) {
    const eaten = entriesOn(S.entries, date);
    const t = eaten.some(isEstimated) ? '~' : '';
    fill(el, h('div', { class: 'headline' },
      h('p', { class: 'headline-figure', 'aria-label': `${t}${eatenLine(S.entries, date)}` },
        h('span', { class: 'num' }, `${t}${(kcalOf(dayTotal(S.entries, date).kcalMilli) ?? 0).toLocaleString('en-GB')}`),
        h('span', { class: 'unit' }, 'kcal eaten today')),
      h('p', { class: 'reason' }, 'Set a daily target to see what’s left.'),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: openSettings }, 'Set a Target'))));
    return;
  }

  const figure = `${hl.estimated ? '~' : ''}${hl.kcal.toLocaleString('en-GB')}`;
  const changed = shownFigure !== null && shownFigure !== figure;
  shownFigure = figure;
  const eatenKcal = kcalOf(dayTotal(S.entries, date).kcalMilli) ?? 0;
  const reason = [
    `${formatKcal(target.kcal)} target`,
    target.addBackKcal ? `with ${formatKcal(target.addBackKcal)} of exercise added back` : null,
  ].filter(Boolean).join(' ');
  fill(el, h('div', { class: 'headline' },
    h('p', { class: 'headline-figure', 'aria-label': hl.text },
      h('span', { class: `num${changed ? ' changed' : ''}` }, figure),
      h('span', { class: 'unit' }, hl.over ? 'kcal over today' : 'kcal left today')),
    hl.proteinText && h('p', { class: 'headline-protein' }, hl.proteinText),
    h('p', { class: 'reason' }, `${hl.estimated ? '~' : ''}${formatKcal(eatenKcal)} eaten of a ${reason}.`)));
}
