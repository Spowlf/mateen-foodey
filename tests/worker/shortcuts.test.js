import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, food, entry } from './helpers.js';

const health = (extra = {}) => ({
  date: '2026-10-12', activeKcal: 480.4, steps: '9,120', weightKg: 72.4,
  workouts: [{ start: '2026-10-12T07:10:00+01:00', type: 'Running', minutes: 31.6, kcal: 310 }],
  ...extra,
});

test('health: replaces the day’s activity and adds each workout once, however often it runs', async () => {
  const w = makeWorker();
  const res = await w.call('POST', '/health', { body: health() });
  assert.equal(res.status, 200);
  assert.equal(res.body, 'Synced 12 Oct: 480 active kcal, 9,120 steps, 72.4 kg, 1 workout.');
  for (let i = 0; i < 3; i++) await w.call('POST', '/health', { body: health({ activeKcal: 620, steps: 11000 }) });
  assert.deepEqual(w.rows('activity').map((a) => [a.id, a.activeKcal, a.steps, a.source]), [['2026-10-12', 620, 11000, 'health']]);
  assert.deepEqual(w.rows('workouts').map((x) => [x.id, x.date, x.minutes, x.kcal]), [['health:2026-10-12T07:10:00+01:00:Running', '2026-10-12', 32, 310]]);
  assert.deepEqual(w.rows('weights').map((x) => [x.id, x.grams, x.source]), [['2026-10-12', 72400, 'health']]);
});

test('health: a run with no weight keeps the day’s reading; a field left out is cleared from the activity', async () => {
  const w = makeWorker();
  await w.call('POST', '/health', { body: health() });
  const res = await w.call('POST', '/health', { body: { date: '2026-10-12', activeKcal: 500 } });
  assert.equal(res.body, 'Synced 12 Oct: 500 active kcal.');
  assert.equal(w.rows('weights')[0].grams, 72400);
  assert.equal(w.rows('activity')[0].steps, null);
  assert.equal(w.rows('workouts').length, 1);
});

test('health: the weight follows the units setting, and bad figures are refused with nothing changed', async () => {
  const w = makeWorker();
  await w.call('PUT', '/settings/weightUnit', { body: { value: 'stlb' } });
  assert.equal((await w.call('POST', '/health', { body: { date: '2026-10-12', weightKg: 72.4 } })).body, 'Synced 12 Oct: 11 st 6 lb.');
  const bad = await w.call('POST', '/health', { body: health({ date: '2026-10-13', weightKg: 7240 }) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body, 'Nothing changed: send a weight from 20 to 400 kg.');
  const noType = await w.call('POST', '/health', { body: health({ date: '2026-10-13', workouts: [{ start: 'x', minutes: 10, kcal: 50 }] }) });
  assert.equal(noType.body, 'Nothing changed: send each workout’s start, type, minutes and kcal.');
  assert.equal(w.rows('activity', "id = '2026-10-13'").length, 0);
});

// Week of Mon 19 Oct 2026: four days marked complete, one unreviewed, one To check entry.
async function week(w) {
  await w.call('PUT', '/targets/2026-10-01', { body: { fromDate: '2026-10-01', mode: 'fixed', kcal: 2000, proteinG: 120, goalRateG: -500 } });
  await w.call('PUT', '/foods/f-oats', { body: food() });
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
  const kcal = [1500, 1700, 1900, 1650];
  const entries = days.map((date, i) => ({ ...entry({ date, nutrition: { ...entry().nutrition, kcalMilli: kcal[i] * 1000 } }), id: `e${i}` }));
  entries.push({ ...entry({ date: '2026-10-24', status: 'toCheck', origin: 'shortcut', portionBasis: 'guessed' }), id: 'e-check' });
  await w.call('POST', '/batch', {
    body: { entries, days: days.map((id) => ({ id, state: 'complete' })), weights: [{ id: '2026-10-18', date: '2026-10-18', grams: 80000 }, { id: '2026-10-25', date: '2026-10-25', grams: 79000 }] },
  });
}

test('summary: from a date, the previous Monday to Sunday', async () => {
  const w = makeWorker();
  await week(w);
  for (const date of ['2026-10-26', '2026-11-01']) {   // Monday and Sunday of the next week
    const res = await w.call('GET', `/summary?date=${date}`);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'Week of 19 Oct 2026. Average 1,688 kcal on 4 complete days, against 2,000 kcal. Protein reached on 0 of 7 days. Trend fell 0.1 kg. 1 entry to check. 3 days to review.');
  }
});

test('summary: from a Monday timestamp in any offset, the week before the one where the phone is', async () => {
  const w = makeWorker();
  await week(w);
  // 07:00 on Monday 26 Oct in Singapore is still Sunday 25 Oct in UTC; the phone's offset decides.
  const sg = await w.call('POST', '/summary', { body: { timestamp: '2026-10-26T07:00:00+08:00' } });
  assert.match(sg.body, /^Week of 19 Oct 2026\./);
  // 23:30 on Sunday 25 Oct in New York is Monday in UTC, but it's still the week of the 19th there.
  const ny = await w.call('POST', '/summary', { body: { timestamp: '2026-10-25T23:30:00-04:00' } });
  assert.match(ny.body, /^Week of 12 Oct 2026\./);
});

test('summary: the Worker never picks the date itself', async () => {
  const w = makeWorker();
  assert.equal((await w.call('GET', '/summary')).body, 'Nothing changed: send the date from the phone.');
  assert.equal((await w.call('POST', '/summary', { body: {} })).body, 'Nothing changed: send the phone’s timestamp.');
});
