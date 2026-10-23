import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodBounds, stepPeriod, periodTitle, periodSummary, macroMeters, proteinDaysText, averageText, lastHealthSync,
} from '../../src/engine/overview.js';
import { targetText, goalPhrase } from '../../src/engine/targets.js';
import { eaten, day } from './fixtures.js';

const target = (extra = {}) => ({ id: '2026-10-01', fromDate: '2026-10-01', mode: 'fixed', kcal: 2000, proteinG: 100, carbsG: null, fatG: null, goalRateG: -500, deletedAt: null, ...extra });
const settings = { floorKcal: 1500, exerciseAddBackPct: 50 };

test('periods: today, Monday to Sunday, the calendar month; stepping back and forward', () => {
  assert.deepEqual(periodBounds('today', '2026-10-23'), { from: '2026-10-23', to: '2026-10-23' });
  assert.deepEqual(periodBounds('week', '2026-10-23'), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(periodBounds('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodBounds('month', '2026-12-31'), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(stepPeriod('week', '2026-10-23', -1), '2026-10-12');
  assert.equal(stepPeriod('month', '2026-01-15', -1), '2025-12-01');
  assert.equal(stepPeriod('month', '2026-12-15', 1), '2027-01-01');
  assert.deepEqual(['today', 'week', 'month'].map((v) => periodTitle(v, '2026-10-23', '2026-10-23')), ['Today', 'This Week', 'This Month']);
  assert.equal(periodTitle('week', '2026-10-12', '2026-10-23'), 'Week of 12 Oct 2026');
  assert.equal(periodTitle('month', '2026-09-01', '2026-10-23'), 'September 2026');
});

test('period: the average counts complete days only, never today, against their targets', () => {
  const entries = [
    eaten('2026-10-19', 1800, { proteinG: 110 }), eaten('2026-10-20', 2200, { proteinG: 90 }),
    eaten('2026-10-21', 900),                      // incomplete: left out of the average
    eaten('2026-10-22', 2500),                     // unreviewed: left out too
    eaten('2026-10-23', 3000, { proteinG: 120 }),  // today, marked or not
  ];
  const days = [day('2026-10-19', 'complete'), day('2026-10-20', 'complete'), day('2026-10-21', 'incomplete'), day('2026-10-23', 'complete')];
  const s = periodSummary({ entries, days, targets: [target()], settings, from: '2026-10-19', to: '2026-10-25', today: '2026-10-23' });
  assert.equal(s.dates.length, 5);                 // days after today left out
  assert.deepEqual([s.completeDays, s.averageKcal, s.averageTargetKcal], [2, 2000, 2000]);
  assert.equal(s.average.proteinUg, 100_000_000);
  assert.equal(averageText(s), 'Average of 2 complete days, against 2,000 kcal.');
  // Protein: Mon reached, Tue, Wed and Thu not, today reached (counted once it's reached).
  assert.deepEqual(s.protein, { reached: 2, of: 5 });
  assert.equal(proteinDaysText(s.protein), 'Protein reached on 2 of 5 days.');
  assert.equal(s.loggedDays, 5);
  assert.equal(s.totalKcal, 10_400);
});

test('period: today not yet reached doesn’t count against protein; no target, no protein line', () => {
  const s = periodSummary({ entries: [eaten('2026-10-23', 500, { proteinG: 20 })], days: [], targets: [target()], settings, from: '2026-10-23', to: '2026-10-23', today: '2026-10-23' });
  assert.deepEqual(s.protein, { reached: 0, of: 0 });
  assert.equal(periodSummary({ entries: [], days: [], targets: [], from: '2026-10-23', to: '2026-10-23', today: '2026-10-23' }).protein, null);
  assert.equal(averageText(s), 'No complete days yet. Only days marked complete count in the average.');
  assert.equal(averageText({ completeDays: 0, loggedDays: 0 }), 'Nothing logged yet.');
});

test('period: calories by meal and the top 5 foods, totals of everything logged', () => {
  const entries = [
    eaten('2026-10-20', 300, { meal: 'breakfast', foodId: 'oats', name: 'Oats' }),
    eaten('2026-10-21', 300, { meal: 'breakfast', foodId: 'oats', name: 'Oats' }),
    eaten('2026-10-21', 700, { meal: 'dinner', batchId: 'b1', name: 'Chilli' }),
    eaten('2026-10-21', 100, { meal: 'snacks', name: 'Quick add' }),
    eaten('2026-10-21', 100, { meal: 'snacks', name: 'Quick add' }),
    eaten('2026-10-21', 50, { meal: 'snacks', name: 'Tea', status: 'toCheck' }),
    eaten('2026-10-21', 40, { meal: 'lunch', name: 'Apple' }),
    eaten('2026-10-21', 10, { meal: 'lunch', name: 'Mint' }),
    eaten('2026-10-21', 999, { meal: 'lunch', name: 'Gone', deletedAt: 5 }),
  ];
  const s = periodSummary({ entries, days: [], from: '2026-10-19', to: '2026-10-25', today: '2026-10-23' });
  assert.deepEqual(s.byMeal.map((m) => [m.meal, m.kcal]), [['breakfast', 600], ['lunch', 50], ['dinner', 700], ['snacks', 250]]);
  assert.equal(s.byMeal[0].share, 600 / 1600);
  assert.deepEqual(s.topFoods.map((f) => [f.name, f.kcal, f.times]), [['Chilli', 700, 1], ['Oats', 600, 2], ['Quick add', 200, 2], ['Tea', 50, 1], ['Apple', 40, 1]]);
  assert.equal(s.estimated, true);                 // the To check tea
});

test('macros: against a target where set, else as a share of the kcal; unknown said so', () => {
  const amounts = { kcalMilli: 2_000_000, proteinUg: 90_000_000, carbsUg: 250_000_000, fatUg: null };
  assert.deepEqual(macroMeters(amounts, { proteinG: 120 }).map((m) => [m.name, m.text, Math.round(m.share * 100)]), [
    ['protein', '90 g of 120 g', 75], ['carbs', '250 g, 50% of kcal', 50], ['fat', 'Fat unknown', 0],
  ]);
});

test('Health: the last time the Shortcut sent activity', () => {
  assert.equal(lastHealthSync([{ source: 'health', updatedAt: 5, deletedAt: null }, { source: 'health', updatedAt: 9, deletedAt: null }, { source: 'manual', updatedAt: 99, deletedAt: null }]), 9);
  assert.equal(lastHealthSync([]), null);
});

test('target: says how it’s counted, fixed or adaptive, and when the floor holds it', () => {
  assert.equal(targetText(null), 'No daily target yet. Set one in Settings.');
  assert.equal(targetText(target(), settings), '2,000 kcal a day, a fixed target you set, with 50% of exercise added back.');
  assert.equal(targetText(target({ mode: 'adaptive', kcal: 2050 }), settings),
    '2,050 kcal a day: your maintenance estimate less 550 kcal, to lose 0.5 kg a week. It changes only when you accept a new one in the weekly review.');
  assert.equal(targetText(target({ kcal: 1200 }), { ...settings, exerciseAddBackPct: 0 }), '1,500 kcal a day, a fixed target you set. It’s held at your floor of 1,500 kcal.');
  assert.deepEqual([-750, 0, 250].map(goalPhrase), ['to lose 0.75 kg a week', 'to maintain your weight', 'to gain 0.25 kg a week']);
});
