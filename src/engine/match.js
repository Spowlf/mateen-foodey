// Matching a typed or parsed food name against foods: your own, the source cache, then the sources.
// A food matches when every word of the search is in its name (plurals folded: "eggs" finds "Egg").
// A food weighed raw never matches one sold cooked, and the other way round; "as sold" fits either.

/** Lower case, accents and punctuation gone, single spaces: "Crème Fraîche, half-fat" → "creme fraiche half fat". */
export function normaliseName(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A word with a plain plural folded ("eggs" → "egg", "glass" stays). */
const fold = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** The words of a name, folded and without repeats. */
export const nameWords = (text) => [...new Set(normaliseName(text).split(' ').filter(Boolean).map(fold))];

/** Does a food fit the state an item was weighed in? Unknown or "as sold" on either side fits. */
export const stateFits = (want, state) => !want || want === 'asSold' || !state || state === 'asSold' || want === state;

/**
 * Foods whose names hold every word of query, best first: the fewest extra words, then a whole
 * food before its parts ("Eggs, chicken, whole, boiled" before the yolk), then the most used, then
 * the shortest name, then by name, so ties never reorder. Each food is { name, brand?, state?, useCount? }.
 * state: the state the item was weighed in; foods in the other state are left out.
 */
export function rankFoods(query, foods, { state = null } = {}) {
  const want = nameWords(query);
  if (!want.length) return [];
  const scored = [];
  for (const food of foods) {
    if (!stateFits(state, food.state)) continue;
    const have = new Set(nameWords(`${food.name ?? ''} ${food.brand ?? ''}`));
    if (!want.every((w) => have.has(w))) continue;
    scored.push({ food, extra: have.size - want.length, part: have.has('whole') ? 0 : 1 });
  }
  scored.sort((a, b) => a.extra - b.extra
    || a.part - b.part
    || (b.food.useCount ?? 0) - (a.food.useCount ?? 0)
    || a.food.name.length - b.food.name.length
    || (a.food.name < b.food.name ? -1 : a.food.name > b.food.name ? 1 : 0));
  return scored.map((s) => s.food);
}

/** A source food's cache key: "off:5010029000016". */
export const sourceKey = (food) => `${food.source}:${food.sourceId}`;
