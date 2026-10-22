// Nutrition in integer units. null is unknown, never zero.
//
// Per 100 g (foods): energy in tenths of a kcal, nutrients in milligrams (Per100g).
// For an amount (entries, batch lines and totals): energy in thousandths of a kcal and nutrients in
// micrograms (Amounts). Per-100 g × grams lands on these exactly (kcalMilli = kcalTenths × grams,
// µg = mg × grams × 10), so logging a food never rounds. Display rounds once.

export const NUTRIENTS = ['protein', 'carbs', 'fat', 'fibre', 'sugars', 'salt'];

/** Amounts' fields, energy first. */
export const AMOUNT_FIELDS = ['kcalMilli', ...NUTRIENTS.map((n) => `${n}Ug`)];

const NAMES = { kcalMilli: 'Energy', proteinUg: 'Protein', carbsUg: 'Carbs', fatUg: 'Fat', fibreUg: 'Fibre', sugarsUg: 'Sugars', saltUg: 'Salt' };

/** n ÷ d rounded half away from zero, so a figure and its negative round alike. */
export function roundDiv(n, d) {
  const q = Math.round(Math.abs(n) / d);
  return n < 0 && q ? -q : q;
}

/** A Per100g with every field unknown. */
export const unknownPer100g = () => ({ kcalTenths: null, ...Object.fromEntries(NUTRIENTS.map((n) => [`${n}Mg`, null])) });

/** The nutrition of grams of a food, exactly. Unknown fields stay null. */
export function amountsFor(per100g, grams, { carbsIncludeFibre = false } = {}) {
  if (!Number.isInteger(grams) || grams < 0) throw new RangeError('grams must be a whole number, 0 or more');
  const scale = (v, k) => (v == null ? null : v * k);
  const out = { kcalMilli: scale(per100g?.kcalTenths, grams) };
  for (const n of NUTRIENTS) out[`${n}Ug`] = scale(per100g?.[`${n}Mg`], grams * 10);
  out.partial = [];
  out.carbsIncludeFibre = !!carbsIncludeFibre;
  return out;
}

/**
 * The sum of several Amounts. A field that's unknown (or itself partial) for some of them is the sum
 * of the known ones, listed in partial, with unknown[field] = how many left it out. A field unknown
 * for all of them is null. Nothing at all sums to zero.
 */
export function sumAmounts(list) {
  const out = { partial: [], unknown: {}, carbsIncludeFibre: false, carbsIncludeFibreCount: 0 };
  for (const f of AMOUNT_FIELDS) {
    let sum = 0;
    let known = 0;
    let unknown = 0;
    for (const a of list) {
      const v = a[f];
      if (v != null) { sum += v; known += 1; }
      if (v == null || a.partial?.includes(f)) unknown += 1;
    }
    out[f] = list.length && !known ? null : sum;
    if (unknown && known) out.partial.push(f);
    if (unknown) out.unknown[f] = unknown;
  }
  out.carbsIncludeFibreCount = list.filter((a) => a.carbsIncludeFibre).length;
  out.carbsIncludeFibre = out.carbsIncludeFibreCount > 0;
  return out;
}

/** Whole kcal from thousandths, rounded once. */
export const kcalOf = (kcalMilli) => (kcalMilli == null ? null : roundDiv(kcalMilli, 1000));

/** Whole grams from micrograms, rounded once. */
export const gramsOf = (ug) => (ug == null ? null : roundDiv(ug, 1_000_000));

const num = (n) => n.toLocaleString('en-GB');

/** "1,240 kcal" */
export const formatKcal = (kcal) => `${num(kcal)} kcal`;

/** "58 g protein", or "150 g" with no label. */
export const formatGrams = (grams, what) => (what ? `${num(grams)} g ${what}` : `${num(grams)} g`);

/**
 * What a total leaves out, one sentence per nutrient ("Fibre unknown for 2 foods."), then
 * "Carbs may include fibre." when it might.
 */
export function unknownLines(total) {
  const lines = [];
  for (const f of AMOUNT_FIELDS) {
    const n = total.unknown?.[f];
    if (n) lines.push(`${NAMES[f]} unknown for ${n} ${n === 1 ? 'food' : 'foods'}.`);
  }
  if (total.carbsIncludeFibre) lines.push('Carbs may include fibre.');
  return lines;
}
