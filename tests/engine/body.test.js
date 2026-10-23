import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metKcal, dayExercise, latestWeight } from '../../src/engine/exercise.js';
import { trendSeries, trendOn, formatWeight, formatWeightChange } from '../../src/engine/weight.js';
import { weighIn } from './fixtures.js';

test('MET: net kcal is (MET − 1) × kg × hours', () => {
  assert.equal(metKcal({ met: 8, weightGrams: 70_000, minutes: 30 }), 245);
  assert.equal(metKcal({ met: 3.5, weightGrams: 80_000, minutes: 45 }), 150);
  assert.equal(metKcal({ met: 1, weightGrams: 80_000, minutes: 60 }), 0);    // resting adds nothing
  assert.equal(metKcal({ met: 8, weightGrams: null, minutes: 30 }), 0);
});

test('MET: uses the latest weight', () => {
  const weights = [weighIn('2026-10-01', 80_000), weighIn('2026-10-10', 79_000), weighIn('2026-10-30', 78_000)];
  assert.equal(latestWeight(weights, '2026-10-20'), 79_000);
  assert.equal(latestWeight(weights, '2026-09-30'), null);
});

test('exercise: manual workouts aren’t added on a day with Health active energy', () => {
  const activity = [{ id: '2026-10-20', date: '2026-10-20', activeKcal: 450, steps: 9000, deletedAt: null }];
  const workouts = [
    { id: 'w1', date: '2026-10-20', kcal: 245, source: 'manual', deletedAt: null },
    { id: 'w2', date: '2026-10-21', kcal: 245, source: 'manual', deletedAt: null },
    { id: 'w3', date: '2026-10-21', kcal: 100, source: 'manual', deletedAt: 5 },
  ];
  assert.deepEqual(dayExercise({ activity, workouts, date: '2026-10-20' }), { kcal: 450, source: 'health', estimated: false });
  assert.deepEqual(dayExercise({ activity, workouts, date: '2026-10-21' }), { kcal: 245, source: 'workouts', estimated: true });
  assert.deepEqual(dayExercise({ activity, workouts, date: '2026-10-22' }), { kcal: 0, source: null, estimated: false });
});

test('trend weight: α = 0.1 a day, carried forward across gaps', () => {
  const weights = [weighIn('2026-10-01', 80_000), weighIn('2026-10-03', 79_000), weighIn('2026-10-05', 78_900)];
  const s = trendSeries(weights, '2026-10-06');
  assert.deepEqual(s.map((p) => [p.date, p.trendGrams, p.readingGrams]), [
    ['2026-10-01', 80_000, 80_000],
    ['2026-10-02', 80_000, null],       // no reading: carried
    ['2026-10-03', 79_900, 79_000],
    ['2026-10-04', 79_900, null],
    ['2026-10-05', 79_800, 78_900],
    ['2026-10-06', 79_800, null],
  ]);
  assert.equal(trendOn(weights, '2026-09-30'), null);
  assert.deepEqual(trendSeries([], '2026-10-06'), []);
});

test('trend weight: the latest reading of a day wins, deleted ones are ignored', () => {
  const weights = [
    { ...weighIn('2026-10-01', 80_000), updatedAt: 1 },
    { ...weighIn('2026-10-01', 81_000), id: 'x', updatedAt: 2 },
    { ...weighIn('2026-10-02', 60_000), deletedAt: 3 },
  ];
  assert.equal(trendOn(weights, '2026-10-02'), 81_000);
});

test('weight: kg or st lb', () => {
  assert.equal(formatWeight(72_449), '72.4 kg');
  assert.equal(formatWeight(72_450), '72.5 kg');
  assert.equal(formatWeight(72_400, 'stlb'), '11 st 6 lb');
  assert.equal(formatWeightChange(-312), '0.3 kg');
  assert.equal(formatWeightChange(318, 'stlb'), '0.7 lb');
});

test('weight: typed in kg or st lb, converted once to grams, with what to do when it can’t be used', async () => {
  const { weightFromText, weightText } = await import('../../src/engine/weight.js');
  assert.deepEqual(weightFromText({ kg: '72.4' }), { grams: 72_400 });
  assert.deepEqual(weightFromText({ kg: '72,4' }), { grams: 72_400 });
  assert.deepEqual(weightFromText({ unit: 'stlb', st: '11', lb: '6' }), { grams: 72_575 });
  assert.deepEqual(weightFromText({ kg: '72.45' }), { error: 'Enter your weight in kg, like 72.4.' });
  assert.deepEqual(weightFromText({ kg: '19' }), { error: 'Enter a weight from 20 to 400 kg.' });
  assert.deepEqual(weightFromText({ unit: 'stlb', st: '11', lb: '14' }), { error: 'Enter stones and pounds, with pounds under 14.' });
  assert.deepEqual(weightText(72_400), { kg: '72.4' });
  assert.deepEqual(weightText(72_575, 'stlb'), { st: '11', lb: '6' });
});

test('weight chart: ranges, points from the first reading, a clean axis and the trend’s change', async () => {
  const { rangeStart, weightPoints, weightScale, weightTick, trendChangeText, lastReading } = await import('../../src/engine/weight.js');
  const weights = [weighIn('2026-10-01', 74_000), weighIn('2026-10-05', 73_000), weighIn('2026-10-20', 72_000)];
  assert.equal(rangeStart('1m', '2026-10-23', weights), '2026-09-23');
  assert.equal(rangeStart('3m', '2026-10-23', weights), '2026-07-24');
  assert.equal(rangeStart('all', '2026-10-23', weights), '2026-10-01');
  const points = weightPoints(weights, '2026-09-23', '2026-10-23');
  assert.equal(points[0].date, '2026-10-01');      // nothing drawn before the first reading
  assert.equal(points.length, 23);
  assert.equal(points.filter((p) => p.readingGrams != null).length, 3);
  assert.deepEqual(weightScale(71_200, 73_900), { min: 71_000, max: 74_000, ticks: [71_000, 72_000, 73_000, 74_000], step: 1 });
  assert.deepEqual(weightScale(72_000, 72_000).ticks, [71_500, 72_000, 72_500]);   // one value still gets an axis
  assert.equal(weightTick(72_500), '72.5');
  assert.equal(weightTick(72_575, 'stlb'), '11 st 6');
  assert.equal(trendChangeText(points), 'Down 0.3 kg since 1 Oct 2026.');
  assert.equal(trendChangeText(points.slice(0, 1)), null);
  assert.deepEqual(lastReading(weights, '2026-10-19'), { date: '2026-10-05', grams: 73_000 });
});
