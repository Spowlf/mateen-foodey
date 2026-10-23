// The weekly review: a card on Log from Monday until it's done, opening one sheet in three steps.
// 1. Clear To check and mark the reviewed week's days ("Mark 5 Days Complete"; flagged days one by
//    one: "Was Tuesday complete?"). 2. See the week. 3. The target: "Use 2,050 kcal" or "Keep 2,100
//    kcal". Then Done, with how many weeks in a row.

import { h, fill, chips, openSheet, toast } from './dom.js';
import { runAction, keepUnits, offlineLabel } from './format.js';
import { meterTable } from './charts.js';
import {
  today, addDays, formatDay, dayName, reviewDue, reviewDays, markDaysLabel, dayRows, dayState, weekSummary, periodSummary, weeklyText,
  maintenanceEstimate, reviewTarget, weeksInARow, doneText, targetRowFor, targetOn, toCheckEntries, dayTotal, kcalOf, formatKcal,
  formatGrams, datesFrom, DEFAULT_SETTINGS, titleCase,
} from '../engine/index.js';

/** The card on Log, or nothing when no review is due. */
export function renderReviewCard(el, repo) {
  const S = repo.state;
  const start = repo.connected() ? reviewDue({ reviews: S.reviews, entries: S.entries, weights: S.weights, today: today() }) : null;
  el.hidden = !start;
  if (!start) return fill(el);
  fill(el, h('div', { class: 'review-card' },
    h('h2', { class: 'subhead' }, 'Weekly Review'),
    h('p', { class: 'reason' }, `Look back at the week of ${formatDay(start)}: mark its days, see how it went and check your target.`),
    h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openReview({ repo, weekStart: start }) }, 'Start the Review'))));
}

export function openReview({ repo, weekStart }) {
  const S = repo.state;
  const end = addDays(weekStart, 6);
  const settings = () => ({ floorKcal: repo.setting('floorKcal', DEFAULT_SETTINGS.floorKcal), exerciseAddBackPct: repo.setting('exerciseAddBackPct', DEFAULT_SETTINGS.exerciseAddBackPct) });
  const unit = repo.setting('weightUnit', 'kg');
  const targetKcal = (date) => targetOn({ targets: S.targets, settings: settings(), activity: S.activity, workouts: S.workouts, date })?.kcal ?? null;
  const body = h('div', { class: 'sheet-form' });
  let step = 1;
  let choice = 'use';
  let busy = false;

  const next = (label, go) => h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'button primary', onclick: go }, label));
  const kcalLine = (date) => {
    const eaten = (kcalOf(dayTotal(S.entries, date).kcalMilli) ?? 0).toLocaleString('en-GB');
    return keepUnits(targetKcal(date) ? `${eaten} of ${formatKcal(targetKcal(date))}` : `${eaten} kcal`);
  };

  async function confirm(entries) {
    const ok = await runAction(() => repo.saveBatch({ entries: entries.map((e) => ({ id: e.id, status: 'logged' })) }));
    if (ok) toast(entries.length === 1 ? `Confirmed ${entries[0].name}.` : `Confirmed ${entries.length} items.`);
    render();
  }

  async function mark(dates, state) {
    const ok = await runAction(() => repo.saveBatch({ days: dayRows(dates, state).map((r) => ({ ...r, deletedAt: null })) }));
    if (ok) toast(dates.length === 1 ? `Marked ${dayName(dates[0])} ${state}.` : `Marked ${dates.length} days ${state}.`);
    render();
  }

  function stepDays() {
    const toCheck = toCheckEntries(S.entries);
    const { toMark, flagged } = reviewDays({ weekStart, today: today(), days: S.days, entries: S.entries, targetKcal });
    const states = datesFrom(weekStart, end).filter((d) => d < today()).map((d) => dayState(S.days, d));
    const complete = states.filter((s) => s === 'complete').length;
    const incomplete = states.filter((s) => s === 'incomplete').length;
    return [
      h('h3', { class: 'subhead' }, 'The Days'),
      toCheck.length > 0 && h('section', { class: 'section', 'aria-label': 'To Check' },
        h('p', {}, toCheck.length === 1 ? '1 entry to check. Confirm it so the week’s figures are right.' : `${toCheck.length} entries to check. Confirm them so the week’s figures are right.`),
        h('ul', { class: 'list' }, toCheck.map((e) => h('li', { class: 'check-row' },
          h('div', { class: 'list-row static' }, h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, e.name),
            h('span', { class: 'list-sub' }, keepUnits([e.grams && formatGrams(e.grams), `~${formatKcal(kcalOf(e.nutrition.kcalMilli) ?? 0)}`, formatDay(e.date)].filter(Boolean).join(', '))))),
          h('button', { type: 'button', class: 'text-button', 'aria-label': `Confirm ${e.name}`, onclick: () => confirm([e]) }, 'Confirm')))),
        toCheck.length > 1 && h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => confirm(toCheck) }, titleCase(`confirm all ${toCheck.length}`)))),
      toMark.length > 0 && h('section', { class: 'section', 'aria-label': 'Days to Mark' },
        h('p', {}, `${toMark.map(dayName).join(', ').replace(/, ([^,]*)$/, ' and $1')} ${toMark.length === 1 ? 'looks' : 'look'} complete.`),
        h('p', { class: 'reason' }, 'Only complete days count in your average and the maintenance estimate. Mark a day incomplete in History if you missed logging something.'),
        h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => mark(toMark, 'complete') }, markDaysLabel(toMark.length)))),
      flagged.map((date) => h('section', { class: 'section', 'aria-label': dayName(date) },
        h('p', {}, `Was ${dayName(date)} complete?`),
        h('p', { class: 'reason' }, `${kcalLine(date)}, under 60% of the target.`),
        h('div', { class: 'link-row' },
          h('button', { type: 'button', class: 'text-button', onclick: () => mark([date], 'complete') }, 'Complete'),
          h('button', { type: 'button', class: 'text-button', onclick: () => mark([date], 'incomplete') }, 'Incomplete')))),
      !toCheck.length && !toMark.length && !flagged.length && h('p', {}, `Every day is marked: ${complete} complete${incomplete ? `, ${incomplete} incomplete` : ''}.`),
      next('See the Week', () => goTo(2)),
    ];
  }

  function stepWeek() {
    const summary = weekSummary({ entries: S.entries, days: S.days, weights: S.weights, targets: S.targets, settings: settings(), activity: S.activity, workouts: S.workouts, start: weekStart });
    const foods = periodSummary({ entries: S.entries, days: S.days, from: weekStart, to: end, today: today() }).topFoods;
    // The summary's sentences, less the first (the week's date, in the title) and what step 1 covered.
    const lines = weeklyText({ ...summary, toCheck: 0, unreviewed: 0 }, { weightUnit: unit }).split(/(?<=\.) /).slice(1);
    return [
      h('h3', { class: 'subhead' }, 'The Week'),
      lines.map((l, i) => h('p', { class: i ? '' : 'headline-protein' }, keepUnits(l))),
      foods.length > 0 && h('section', { class: 'section', 'aria-label': 'Top Foods' },
        h('h3', { class: 'subhead' }, 'Top Foods'),
        meterTable(foods.map((f) => ({ name: f.name, value: keepUnits(formatKcal(f.kcal)), share: f.share, note: f.times === 1 ? 'Once' : `${f.times} times` })), { caption: 'Top foods by kcal', head: ['Food', 'Kcal', 'Times'] })),
      next('See Your Target', () => goTo(3)),
    ];
  }

  function stepTarget() {
    const now = today();
    const current = targetRowFor(S.targets, now);
    const summary = weekSummary({ entries: S.entries, days: S.days, weights: S.weights, targets: S.targets, settings: settings(), start: weekStart });
    const estimate = maintenanceEstimate({ entries: S.entries, days: S.days, weights: S.weights, end });
    const proposal = reviewTarget({ current, estimate, trendChangeGrams: summary.trendChangeGrams, floorKcal: settings().floorKcal, unit });
    const blocked = offlineLabel(repo);
    const done = h('button', { type: 'button', class: 'button primary', disabled: !!blocked || busy, onclick: () => finish(current, proposal) }, blocked ?? (busy ? 'Saving' : 'Done'));
    return [
      h('h3', { class: 'subhead' }, 'Your Target'),
      h('p', {}, keepUnits(proposal.text)),
      proposal.proposedKcal != null && chips({
        label: 'Target',
        options: [
          { value: 'use', label: keepUnits(`Use ${formatKcal(proposal.proposedKcal)}`) },
          { value: 'keep', label: keepUnits(`Keep ${formatKcal(proposal.currentKcal)}`) },
        ],
        value: choice,
        onChange: (v) => { choice = v; },
      }),
      proposal.proposedKcal != null && h('p', { class: 'reason' }, 'A new target applies from today. Past days keep theirs.'),
      h('div', { class: 'sheet-actions' }, done),
    ];
  }

  async function finish(current, proposal) {
    if (busy) return;
    busy = true;
    render();
    const now = today();
    const changes = { reviews: [{ id: weekStart, weekStart, completedAt: Date.now(), deletedAt: null }] };
    const using = proposal.proposedKcal != null && choice === 'use';
    if (using) {
      const { mode, proteinG, carbsG, fatG, goalRateG } = current;
      changes.targets = [{ id: now, fromDate: now, mode, kcal: proposal.proposedKcal, proteinG, carbsG, fatG, goalRateG, deletedAt: null }];
    }
    const ok = await runAction(() => repo.saveBatch(changes));
    busy = false;
    if (!ok) return render();
    s.close();
    const n = weeksInARow(S.reviews, weekStart);
    toast(keepUnits(`${doneText(n)}${using ? ` Target set: ${formatKcal(proposal.proposedKcal)} a day.` : ''}`));
  }

  function render() {
    fill(body, step === 1 ? stepDays() : step === 2 ? stepWeek() : stepTarget());
  }

  /** A new step starts at the top of the sheet. */
  const goTo = (n) => { step = n; render(); body.closest('dialog')?.scrollTo(0, 0); };

  const s = openSheet({ title: `Week of ${formatDay(weekStart)}` }, body);
  render();
  return s;
}
