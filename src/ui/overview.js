// Overview: Today, a week or a month. The raised panel answers "how am I doing?": today's kcal
// against its target, or a period's average of complete days against theirs, then protein days.
// Below: macros as meters, calories by meal, the top 5 foods, and Sync Health.

import { h, fill, segmented, icon } from './dom.js';
import { keepUnits } from './format.js';
import { meterTable } from './charts.js';
import {
  today, periodBounds, stepPeriod, periodTitle, periodSummary, macroMeters, proteinDaysText, averageText, lastHealthSync,
  targetOn, dayExercise, dayTotal, entriesOn, isEstimated, kcalOf, formatKcal, mealName, syncedPhrase, titleCase,
} from '../engine/index.js';

const SYNC_HEALTH = 'shortcuts://run-shortcut?name=Sync%20Health';

// The view and period are kept while you move between tabs.
let view = 'today';
let anchor = null;

export function renderOverview(root, { repo }) {
  const S = repo.state;
  const body = h('div', { class: 'screen' });
  const toggle = segmented({
    label: 'Show',
    options: [{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }],
    value: view,
    onChange: (v) => { view = v; anchor = today(); render(); },
  });
  fill(root, h('div', { class: 'screen' }, toggle, body));

  const settings = () => ({ floorKcal: repo.setting('floorKcal') ?? undefined, exerciseAddBackPct: repo.setting('exerciseAddBackPct') ?? undefined });
  const targetFor = (date) => targetOn({ targets: S.targets, settings: settings(), activity: S.activity, workouts: S.workouts, date });

  /** The week or month with arrows to step back and forward (never past this one). */
  function periodNav() {
    const now = today();
    const { to } = periodBounds(view, anchor);
    const title = periodTitle(view, anchor, now);
    const unit = view === 'week' ? 'week' : 'month';
    return h('div', { class: 'period-nav' },
      h('button', { type: 'button', class: 'icon-button', 'aria-label': `Previous ${unit}`, onclick: () => { anchor = stepPeriod(view, anchor, -1); render(); } }, icon('back')),
      h('h2', { class: 'subhead', 'aria-live': 'polite' }, title),
      h('button', {
        type: 'button', class: 'icon-button', 'aria-label': `Next ${unit}`, disabled: to >= now,
        onclick: () => { anchor = stepPeriod(view, anchor, 1); render(); },
      }, icon('forward')));
  }

  function todayPanel(date) {
    const target = targetFor(date);
    const total = dayTotal(S.entries, date);
    const t = entriesOn(S.entries, date).some(isEstimated) ? '~' : '';
    const kcal = kcalOf(total.kcalMilli) ?? 0;
    const exercise = dayExercise({ activity: S.activity, workouts: S.workouts, date });
    const reason = target
      ? `Of a ${formatKcal(target.kcal)} target${target.addBackKcal ? `, with ${formatKcal(target.addBackKcal)} of exercise added back` : ''}.`
      : 'Set a daily target in Settings to see it against one.';
    const exerciseLine = exercise.source === 'health' ? `${formatKcal(exercise.kcal)} active, from Health.`
      : exercise.source === 'workouts' ? `${exercise.estimated ? '~' : ''}${formatKcal(exercise.kcal)} from workouts.` : null;
    const steps = S.activity.find((a) => !a.deletedAt && a.date === date)?.steps;
    return {
      panel: h('div', { class: 'headline' },
        h('p', { class: 'headline-figure', 'aria-label': `${t}${formatKcal(kcal)} eaten today.` },
          h('span', { class: 'num' }, `${t}${kcal.toLocaleString('en-GB')}`), h('span', { class: 'unit' }, 'kcal eaten')),
        h('p', { class: 'reason' }, keepUnits(reason)),
        (exerciseLine || steps != null) && h('p', { class: 'reason' }, [exerciseLine, steps != null ? `${steps.toLocaleString('en-GB')} steps.` : null].filter(Boolean).join(' '))),
      macros: macroMeters(total, target),
      macroNote: null,
    };
  }

  function periodPanel(s) {
    const proteinLine = proteinDaysText(s.protein);
    return {
      panel: h('div', { class: 'headline' },
        s.completeDays
          ? h('p', { class: 'headline-figure', 'aria-label': `${formatKcal(s.averageKcal)} a day on average.` },
            h('span', { class: 'num' }, s.averageKcal.toLocaleString('en-GB')), h('span', { class: 'unit' }, 'kcal a day'))
          : null,
        h('p', { class: s.completeDays ? 'reason' : '' }, keepUnits(averageText(s))),
        proteinLine && h('p', { class: 'headline-protein' }, proteinLine)),
      macros: s.average ? macroMeters(s.average, targetFor(s.dates.at(-1))) : null,
      macroNote: s.average ? 'A complete day on average.' : null,
    };
  }

  function render() {
    toggle.set(view);
    const now = today();
    anchor ??= now;
    const { from, to } = periodBounds(view, view === 'today' ? now : anchor);
    const s = periodSummary({ entries: S.entries, days: S.days, targets: S.targets, settings: settings(), activity: S.activity, workouts: S.workouts, from, to, today: now });
    const top = view === 'today' ? todayPanel(now) : periodPanel(s);
    const allDays = view === 'today' ? null : `All logged days, ${s.loggedDays} so far.`;
    const healthAt = lastHealthSync(S.activity);

    fill(body,
      view !== 'today' && periodNav(),
      top.panel,
      top.macros && h('section', { class: 'section', 'aria-label': 'Macros' },
        h('h2', { class: 'subhead' }, 'Macros'),
        meterTable(top.macros.map((m) => ({ name: titleCase(m.name), value: m.text, share: m.share, note: '' })), { caption: 'Macros', head: ['Macro', 'Grams', 'Share'] }),
        top.macroNote && h('p', { class: 'reason' }, top.macroNote)),
      s.totalKcal > 0 && h('section', { class: 'section', 'aria-label': 'Calories by Meal' },
        h('h2', { class: 'subhead' }, 'Calories by Meal'),
        meterTable(s.byMeal.map((m) => ({ name: mealName(m.meal), value: keepUnits(formatKcal(m.kcal)), share: m.share })), { caption: 'Calories by meal', head: ['Meal', 'Kcal', 'Share'] }),
        allDays && h('p', { class: 'reason' }, allDays)),
      s.topFoods.length > 0 && h('section', { class: 'section', 'aria-label': 'Top Foods' },
        h('h2', { class: 'subhead' }, 'Top Foods'),
        meterTable(s.topFoods.map((f) => ({ name: f.name, value: keepUnits(formatKcal(f.kcal)), share: f.share, note: f.times === 1 ? 'Once' : `${f.times} times` })), { caption: 'Top foods by kcal', head: ['Food', 'Kcal', 'Times'] }),
        h('p', { class: 'reason' }, view === 'today' ? 'By kcal today.' : 'By kcal, all logged days.')),
      !s.totalKcal && view === 'today' && h('p', { class: 'empty-line' }, 'Meals, macros and top foods appear here once you log something today.'),
      h('section', { class: 'section', 'aria-label': 'Health' },
        h('h2', { class: 'subhead' }, 'Health'),
        h('p', { class: 'reason' }, healthAt ? `${syncedPhrase(healthAt).replace('Last synced', 'Health last synced')}.` : 'Health hasn’t synced yet. Set up the Sync Health Shortcut first.'),
        h('div', {}, h('a', { class: 'text-button', href: SYNC_HEALTH }, 'Sync Health'))));
  }

  render();
  return { refresh: () => render() };
}
