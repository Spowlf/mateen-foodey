import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayTarget, adaptiveKcal, acceptedTarget, targetRowFor, dailyChangeKcal } from '../../src/engine/targets.js';
import { headline } from '../../src/engine/headline.js';
import { dayExercise } from '../../src/engine/exercise.js';
import { eaten } from './fixtures.js';

const fixed = { id: '2026-10-01', fromDate: '2026-10-01', mode: 'fixed', kcal: 2000, proteinG: 120, carbsG: null, fatG: null, goalRateG: -500, deletedAt: null };
const adaptive = { ...fixed, mode: 'adaptive', kcal: 2100 };
const settings = { floorKcal: 1500, exerciseAddBackPct: 50 };

test('adaptive target: maintenance ± goal rate × 7,700 ÷ 7', () => {
  assert.equal(dailyChangeKcal(-500), -550);
  assert.equal(dailyChangeKcal(-250), -275);
  assert.equal(dailyChangeKcal(250), 275);
  assert.equal(adaptiveKcal({ maintenanceKcal: 2350, goalRateG: -500 }), 1800);
  assert.equal(adaptiveKcal({ maintenanceKcal: 2350, goalRateG: 0 }), 2350);
});

test('targets: never below the floor', () => {
  assert.equal(adaptiveKcal({ maintenanceKcal: 1900, goalRateG: -750, floorKcal: 1500 }), 1500);
  assert.equal(dayTarget({ targets: [{ ...fixed, kcal: 1200 }], date: '2026-10-20', settings }).kcal, 1500);
  assert.equal(dayTarget({ targets: [{ ...fixed, kcal: 1200 }], date: '2026-10-20', settings: { floorKcal: 1000 } }).kcal, 1200);
});

test('targets: exercise added back in fixed mode only', () => {
  assert.equal(dayTarget({ targets: [fixed], date: '2026-10-20', settings, exerciseKcal: 401 }).kcal, 2201);   // 50% of 401, rounded
  assert.equal(dayTarget({ targets: [adaptive], date: '2026-10-20', settings, exerciseKcal: 400 }).kcal, 2100);
  assert.equal(dayTarget({ targets: [fixed], date: '2026-10-20', settings: { exerciseAddBackPct: 0 }, exerciseKcal: 400 }).kcal, 2000);
});

test('targets: the target changes only when accepted', () => {
  const targets = [adaptive];
  // A new maintenance estimate alone changes nothing.
  assert.equal(dayTarget({ targets, date: '2026-10-20', settings }).kcal, 2100);
  const accepted = acceptedTarget(adaptive, { kcal: 2050, fromDate: '2026-10-19' });
  const after = [...targets, accepted];
  assert.equal(dayTarget({ targets: after, date: '2026-10-20', settings }).kcal, 2050);
  assert.equal(dayTarget({ targets: after, date: '2026-10-18', settings }).kcal, 2100);   // past days keep theirs
  assert.equal(accepted.id, '2026-10-19');
  assert.equal(targetRowFor(after, '2026-09-30'), null);
});

const target = (extra = {}, exerciseKcal = 0, rows = [fixed]) => ({ ...dayTarget({ targets: rows, date: '2026-10-23', settings, exerciseKcal }), ...extra });

test('headline: left today, plain', () => {
  const h = headline({ entries: [eaten('2026-10-23', 760, { proteinG: 28 }), eaten('2026-10-22', 900)], date: '2026-10-23', target: target() });
  assert.equal(h.text, '1,240 kcal left today.');
  assert.equal(h.proteinText, '92 g protein to go.');
  assert.equal(h.over, false);
});

test('headline: over today', () => {
  const h = headline({ entries: [eaten('2026-10-23', 2180, { proteinG: 130 })], date: '2026-10-23', target: target() });
  assert.equal(h.text, '180 kcal over today.');
  assert.equal(h.proteinText, 'Protein target reached.');
  assert.equal(h.over, true);
});

test('headline: To check entries count, as estimates', () => {
  const entries = [eaten('2026-10-23', 760, { proteinG: 28 }), eaten('2026-10-23', 300, { proteinG: 10, status: 'toCheck' })];
  const h = headline({ entries, date: '2026-10-23', target: target() });
  assert.equal(h.text, '~940 kcal left today.');
  assert.equal(h.proteinText, '~82 g protein to go.');
});

test('headline: exercise added back in fixed mode only, and manual exercise makes it "~"', () => {
  const workouts = [{ id: 'w', date: '2026-10-23', kcal: 400, source: 'manual', deletedAt: null }];
  const exercise = dayExercise({ workouts, date: '2026-10-23' });
  const entries = [eaten('2026-10-23', 760, { proteinG: 120 })];
  assert.equal(headline({ entries, date: '2026-10-23', target: target({}, exercise.kcal), exercise }).text, '~1,440 kcal left today.');
  const health = dayExercise({ activity: [{ id: 'a', date: '2026-10-23', activeKcal: 400, deletedAt: null }], workouts, date: '2026-10-23' });
  assert.equal(headline({ entries, date: '2026-10-23', target: target({}, health.kcal), exercise: health }).text, '1,440 kcal left today.');
  assert.equal(headline({ entries, date: '2026-10-23', target: target({}, exercise.kcal, [adaptive]), exercise }).text, '1,340 kcal left today.');
});

test('headline: unknown protein makes the protein line "~"; no target, no headline', () => {
  const entries = [eaten('2026-10-23', 500, { proteinG: 20 }), eaten('2026-10-23', 200)];
  assert.equal(headline({ entries, date: '2026-10-23', target: target() }).proteinText, '~100 g protein to go.');
  assert.equal(headline({ entries, date: '2026-10-23', target: null }), null);
});
