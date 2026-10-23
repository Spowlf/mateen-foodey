// Food search results: your own foods first (on the phone, so they work offline), then the sources
// (CoFID, Open Food Facts, USDA), asked only after a pause in typing, so each keystroke isn't a request.

import { h, fill } from './dom.js';
import { foodSub } from './format.js';
import { rankFoods, normaliseName, isLive, nameCase } from '../engine/index.js';
import { OfflineError } from '../errors.js';

export const SEARCH_PAUSE_MS = 400;
const OWN_SHOWN = 5;
const MIN_QUERY = 2;

const UNAVAILABLE = { off: 'Open Food Facts', usda: 'USDA' };

/**
 * createFoodSearch({ repo, onPick, extra }) returns { el, search(query, { state }) }. extra(query) can
 * give rows to show first (a barcode lookup, a parse's alternatives). onPick(food) runs on a tap.
 */
export function createFoodSearch({ repo, onPick, extra = () => [] }) {
  const el = h('div', { class: 'results', 'aria-live': 'polite' });
  let timer = null;
  let asked = '';
  let remote = { query: '', results: [], note: null };

  const row = (food) => h('li', {},
    h('button', { type: 'button', class: 'list-row', onclick: () => onPick(food) },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, nameCase(food.name)),
        h('span', { class: 'list-sub' }, foodSub(food)))));

  function render(query, state) {
    const q = normaliseName(query);
    const first = extra(query);
    if (q.length < MIN_QUERY && !first.length) return fill(el);
    const own = q.length < MIN_QUERY ? [] : rankFoods(q, repo.state.foods.filter(isLive), { state }).slice(0, OWN_SHOWN);
    const ownKeys = new Set(own.map((f) => `${f.source}:${f.sourceId}`));
    const sources = remote.query === q ? remote.results.filter((f) => !ownKeys.has(`${f.source}:${f.sourceId}`)) : [];
    const waiting = q.length >= MIN_QUERY && remote.query !== q && repo.connected();
    fill(el,
      first,
      own.length > 0 && h('ul', { class: 'list', 'aria-label': 'Your foods' }, own.map(row)),
      sources.length > 0 && h('ul', { class: 'list', 'aria-label': 'Food databases' }, sources.map(row)),
      waiting && h('p', { class: 'reason' }, 'Searching the food databases.'),
      remote.query === q && remote.note && h('p', { class: 'reason' }, remote.note),
      q.length >= MIN_QUERY && !waiting && !first.length && !own.length && !sources.length && !remote.note && h('p', { class: 'empty-line' }, 'No foods found. Try fewer words.'));
  }

  async function ask(q, query, state) {
    asked = q;
    let next;
    try {
      const { results, unavailable } = await repo.search(q);
      const missing = unavailable.map((s) => UNAVAILABLE[s]).filter(Boolean);
      next = { query: q, results, note: missing.length ? `${missing.join(' and ')} couldn’t be reached, so ${missing.length === 1 ? 'its foods aren’t' : 'their foods aren’t'} shown.` : null };
    } catch (err) {
      next = { query: q, results: [], note: err instanceof OfflineError ? 'You’re offline, so only your foods are shown.' : err.message };
    }
    if (asked !== q) return;   // a newer search has started
    remote = next;
    render(query, state);
  }

  return {
    el,
    search(query, { state = null } = {}) {
      clearTimeout(timer);
      const q = normaliseName(query);
      render(query, state);
      if (q.length < MIN_QUERY || remote.query === q || !repo.connected()) return;
      timer = setTimeout(() => ask(q, query, state), SEARCH_PAUSE_MS);
    },
    clear() {
      clearTimeout(timer);
      asked = '';
      fill(el);
    },
  };
}
