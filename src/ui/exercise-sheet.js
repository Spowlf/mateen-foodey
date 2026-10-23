// Manual exercise: an activity (MET values from the 2024 Adult Compendium, in data/activities.json)
// and minutes. kcal = (MET − 1) × your latest weight in kg × hours, net of resting like Health's
// active energy, and always "~". On a day Health sent active energy, it isn't added again.

import { h, fill, chips, field, openSheet, toast } from './dom.js';
import { runAction, offlineLabel, keepUnits, deleteWithUndo } from './format.js';
import { manualWorkout, metText, latestWeight, typedWhole, today, formatDay, formatKcal } from '../engine/index.js';

let catalogue = null;

/** data/activities.json, fetched once (the service worker keeps it for offline). */
async function activities() {
  catalogue ??= fetch('data/activities.json').then((r) => {
    if (!r.ok) throw new Error('the activity list couldn’t be loaded');
    return r.json();
  }).catch((err) => { catalogue = null; throw err; });
  return catalogue;
}

const MINUTES = [15, 30, 45, 60];

/** Adds a workout on date. */
export async function openExerciseSheet({ repo, date = today() }) {
  let data;
  try {
    data = await activities();
  } catch {
    return toast('The activity list couldn’t be loaded. Try again online.');
  }
  let group = data.groups[0].id;
  let activity = null;
  let busy = false;
  const weightGrams = latestWeight(repo.state.weights, date);

  const groupChips = chips({ label: 'Kind', options: data.groups.map((g) => ({ value: g.id, label: g.name })), value: group, onChange: (v) => { group = v; activity = null; renderActivities(); render(); } });
  const activityBox = h('div', {});
  const minutes = h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'done', placeholder: '30', oninput: () => { minuteChips.set(null); render(); } });
  const minuteChips = chips({ label: 'Minutes', options: MINUTES.map((m) => ({ value: m, label: `${m} min` })), value: null, onChange: (v) => { minutes.value = String(v); render(); } });
  const how = h('p', { class: 'reason', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function renderActivities() {
    fill(activityBox, chips({
      label: 'Activity',
      options: data.activities.filter((a) => a.group === group).map((a) => ({ value: a.id, label: a.name })),
      value: activity?.id ?? null,
      onChange: (id) => { activity = data.activities.find((a) => a.id === id); render(); },
    }));
  }

  const attempt = () => manualWorkout({ id: crypto.randomUUID(), date, activity, minutes: typedWhole(minutes.value), weightGrams });

  function render() {
    const r = attempt();
    const blocked = offlineLabel(repo);
    how.textContent = r.row
      ? keepUnits(`${metText({ met: activity.met, weightGrams, minutes: r.row.minutes })} Above resting, like Health’s active energy, and an estimate.`)
      : weightGrams ? 'Pick an activity and the minutes. The kcal come from its MET value and your latest weight.' : 'Add a weight on the Weight screen first: the kcal depend on it.';
    save.disabled = busy || !!blocked || !r.row;
    save.textContent = busy ? 'Saving' : blocked ?? (r.row ? `Add ~${formatKcal(r.row.kcal)}` : !activity ? 'Pick an Activity' : weightGrams ? 'Enter the Minutes' : 'Add a Weight First');
  }

  async function submit() {
    const r = attempt();
    if (busy || !r.row) return;
    busy = true;
    render();
    const ok = await runAction(() => repo.saveRow('workouts', r.row.id, r.row));
    busy = false;
    if (!ok) return render();
    s.close();
    toast(keepUnits(`Added ${r.row.type}, ${r.row.minutes} min, ~${formatKcal(r.row.kcal)}.`), {
      label: 'Undo',
      run: () => runAction(async () => { await repo.deleteRow('workouts', r.row.id); toast('Removed.'); }),
    });
  }

  const s = openSheet({ title: date === today() ? 'Add Exercise' : `Add Exercise, ${formatDay(date)}` },
    h('div', { class: 'sheet-form' },
      field('Kind', groupChips),
      field('Activity', activityBox),
      field('Minutes', minutes),
      minuteChips,
      how,
      h('div', { class: 'sheet-actions' }, save)));
  renderActivities();
  render();
  return s;
}

/** A workout you added: how it was counted, and Delete. Health's workouts are Health's to change. */
export function openWorkoutSheet({ repo, workout }) {
  const s = openSheet({ title: workout.type },
    h('div', { class: 'sheet-form' },
      h('p', {}, keepUnits(`${workout.minutes} min, ${workout.source === 'manual' ? '~' : ''}${formatKcal(workout.kcal)}${workout.source === 'health' ? ', from Health' : ''}.`)),
      h('p', { class: 'reason' }, workout.source === 'manual'
        ? 'Worked out from the activity’s MET value and your weight at the time, above resting.'
        : 'Sent by the Health Shortcut. Change it in the Health app.'),
      workout.source === 'manual' && h('div', { class: 'sheet-actions' },
        h('div', {}, h('button', {
          type: 'button', class: 'text-button danger',
          onclick: async () => { if (await deleteWithUndo(repo, 'workouts', { id: workout.id, name: workout.type })) s.close(); },
        }, 'Delete Workout')))));
  return s;
}
