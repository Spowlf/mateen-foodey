// Frozen test data. Engine tests use these, never real source data, so a change elsewhere never breaks a maths test.

const freeze = (o) => Object.freeze(structuredClone(o));

export const OATS = freeze({
  id: 'f-oats', name: 'Porridge oats', brand: null, state: 'raw', source: 'cofid', sourceId: '11-001', assumptions: null,
  per100g: { kcalTenths: 3750, proteinMg: 11200, carbsMg: 60400, fatMg: 8000, fibreMg: 9000, sugarsMg: 0, saltMg: null },
  carbsIncludeFibre: false, servings: [], gramsPer100ml: 100,
});

export const MILK = freeze({
  id: 'f-milk', name: 'Semi-skimmed milk', brand: null, state: 'asSold', source: 'cofid', sourceId: '12-001', assumptions: null,
  per100g: { kcalTenths: 460, proteinMg: 3500, carbsMg: 4700, fatMg: 1700, fibreMg: 0, sugarsMg: 4700, saltMg: 100 },
  carbsIncludeFibre: false, servings: [], gramsPer100ml: 103,
});

export const HONEY = freeze({
  id: 'f-honey', name: 'Honey', brand: null, state: 'asSold', source: 'estimate', sourceId: null, assumptions: 'Assumed clear honey.',
  per100g: { kcalTenths: 3040, proteinMg: 300, carbsMg: 82400, fatMg: 0, fibreMg: null, sugarsMg: 82100, saltMg: 10 },
  carbsIncludeFibre: false, servings: [], gramsPer100ml: 100,
});

export const BREAD = freeze({
  id: 'f-bread', name: 'White bread', brand: 'Hovis', state: 'asSold', source: 'off', sourceId: '5010029000016', assumptions: null,
  per100g: { kcalTenths: 2330, proteinMg: 8400, carbsMg: 43400, fatMg: 1600, fibreMg: 2800, sugarsMg: 3400, saltMg: 880 },
  carbsIncludeFibre: false, servings: [{ label: '1 slice', grams: 40 }], gramsPer100ml: 100,
});

let n = 0;

/** A logged entry of kcal (and optional protein grams) on date, made with quick add. */
export function eaten(date, kcal, { proteinG = null, status = 'logged', ...extra } = {}) {
  n += 1;
  return {
    id: `e${n}`, date, meal: 'lunch', foodId: null, batchId: null, name: 'Meal', grams: null,
    nutrition: {
      kcalMilli: kcal * 1000, proteinUg: proteinG == null ? null : proteinG * 1_000_000, carbsUg: null, fatUg: null,
      fibreUg: null, sugarsUg: null, saltUg: null, partial: [], carbsIncludeFibre: false,
    },
    nutritionBasis: 'quick', portionBasis: null, assumptions: null, status, origin: 'quick', createdAt: 0, deletedAt: null, ...extra,
  };
}

/** A weight reading. */
export const weighIn = (date, grams) => ({ id: date, date, grams, source: 'manual', deletedAt: null });

/** A days row. */
export const day = (date, state) => ({ id: date, state, deletedAt: null });

/** Every date from a to b. */
export function range(a, b) {
  const out = [];
  for (let d = new Date(`${a}T00:00:00Z`); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
