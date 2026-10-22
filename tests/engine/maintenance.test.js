import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceEstimate, rawEstimate, neededMessage } from '../../src/engine/maintenance.js';
import { eaten, weighIn, day, range } from './fixtures.js';

// 28-day window to Sunday 18 Oct 2026 starts Monday 21 Sep.
const END = '2026-10-18';

function data({ from = '2026-09-01', to = END, kcal = () => 2000, state = () => 'complete', weight = () => 80_000, weighOn = () => true } = {}) {
  const dates = range(from, to);
  return {
    entries: dates.map((d) => eaten(d, kcal(d))),
    days: dates.filter((d) => state(d)).map((d) => day(d, state(d))),
    weights: dates.filter(weighOn).map((d) => weighIn(d, weight(d))),
  };
}

test('maintenance: average intake on complete days when the trend is flat', () => {
  const r = maintenanceEstimate({ ...data(), end: END });
  assert.equal(r.ok, true);
  assert.equal(r.kcal, 2000);
  assert.equal(r.completeDays, 28);
  assert.equal(r.text, '~2,000 kcal, from 28 complete days and your weight trend.');
});

test('maintenance: unreviewed and incomplete days are left out', () => {
  // Odd days are complete at 2,000; even days are unreviewed (5,000) or incomplete (500).
  const d = data({
    kcal: (date) => (Number(date.slice(8)) % 2 ? 2000 : Number(date.slice(8)) % 4 ? 5000 : 500),
    state: (date) => (Number(date.slice(8)) % 2 ? 'complete' : Number(date.slice(8)) % 4 ? null : 'incomplete'),
  });
  const r = maintenanceEstimate({ ...d, end: END });
  assert.equal(r.kcal, 2000);
  assert.equal(r.completeDays, 14);
});

test('maintenance: only the 28-day window counts', () => {
  // A huge day just before the window changes nothing.
  const d = data({ kcal: (date) => (date === '2026-09-20' ? 20_000 : 2000) });
  assert.equal(rawEstimate({ ...d, end: END }).kcal, 2000);
  assert.equal(rawEstimate({ ...d, end: END }).completeDays, 28);
});

test('maintenance: the trend’s change is taken off at 7,700 kcal a kg over 28 days', () => {
  // 80 kg to 4 Oct, then 79 kg daily: the trend falls 1,000 × (1 − 0.9¹⁴) g by 18 Oct.
  const r = maintenanceEstimate({ ...data({ weight: (date) => (date <= '2026-10-04' ? 80_000 : 79_000) }), end: END });
  assert.equal(r.kcal, 2212);   // 2,000 + 7,700 × 0.7712 ÷ 28
  assert.equal(r.capped, false);
});

test('maintenance: needs 14 complete days and 8 weigh-ins', () => {
  const thirteen = data({ from: '2026-10-06' });   // 13 days
  const r = maintenanceEstimate({ ...thirteen, end: END });
  assert.equal(r.ok, false);
  assert.equal(r.text, 'Log 1 more complete day.');
  const fewWeighIns = data({ weighOn: (date) => date >= '2026-10-12' });   // 7
  assert.equal(maintenanceEstimate({ ...fewWeighIns, end: END }).text, 'Add 1 more weigh-in.');
  const fourteen = maintenanceEstimate({ ...data({ from: '2026-10-05' }), end: END });
  assert.deepEqual([fourteen.ok, fourteen.completeDays, fourteen.weighIns], [true, 14, 14]);
});

test('maintenance message: built from what’s still needed, each part only while needed', () => {
  assert.equal(neededMessage({ completeDays: 8, weighIns: 6 }), 'Log 6 more complete days and add 2 more weigh-ins.');
  assert.equal(neededMessage({ completeDays: 8, weighIns: 8 }), 'Log 6 more complete days.');
  assert.equal(neededMessage({ completeDays: 20, weighIns: 7 }), 'Add 1 more weigh-in.');
  assert.equal(neededMessage({ completeDays: 13, weighIns: 0 }), 'Log 1 more complete day and add 8 more weigh-ins.');
  assert.equal(neededMessage({ completeDays: 14, weighIns: 8 }), null);
  const none = maintenanceEstimate({ entries: [], days: [], weights: [], end: END });
  assert.equal(none.text, 'Log 14 more complete days and add 8 more weigh-ins.');
});

test('maintenance: moves at most 150 kcal a week', () => {
  // 2,000 a day until 11 Oct, then 4,000: the raw estimate jumps to 2,500.
  const d = data({ kcal: (date) => (date >= '2026-10-12' ? 4000 : 2000) });
  assert.equal(rawEstimate({ ...d, end: END }).kcal, 2500);
  const r = maintenanceEstimate({ ...d, end: END });
  assert.equal(r.kcal, 2150);
  assert.equal(r.capped, true);
  // A week later it moves on by at most another 150.
  const later = data({ to: '2026-10-25', kcal: (date) => (date >= '2026-10-12' ? 4000 : 2000) });
  assert.equal(maintenanceEstimate({ ...later, end: '2026-10-25' }).kcal, 2300);
});
