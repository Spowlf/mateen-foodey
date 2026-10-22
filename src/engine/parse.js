// Sentence and photo logging: checking what the model sends back, and what's uncertain about each line.
// The parse step gives names and amounts only; nutrition from it is never accepted. The estimate
// step gives per-100 g nutrition for foods nothing matched, with the assumptions behind it.

export const MAX_GRAMS = 5000;
const STATES = new Set(['raw', 'cooked', 'asSold']);

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Whole grams above zero and at most 5,000, or null. */
export function cleanGrams(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const g = Math.round(v);
  return g > 0 && g <= MAX_GRAMS ? g : null;
}

/** The parse step's JSON schema (structured output). */
export const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unit', 'grams', 'gramsAssumed', 'state', 'searchTerm'],
        properties: {
          name: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          grams: { type: ['integer', 'null'] },
          gramsAssumed: { type: 'boolean' },
          state: { type: 'string', enum: ['raw', 'cooked', 'asSold', 'unknown'] },
          searchTerm: { type: 'string' },
        },
      },
    },
  },
};

/**
 * The parse step's items, checked: only the known fields are kept (nutrition and anything else
 * dropped), a nameless item is dropped, and grams outside 1–5,000 become null for you to enter.
 */
export function cleanParse(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.flatMap((it) => {
    const name = text(it?.name);
    if (!name) return [];
    const quantity = typeof it.quantity === 'number' && Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : null;
    return [{
      name,
      quantity,
      unit: text(it.unit),
      grams: cleanGrams(it.grams),
      gramsAssumed: it.gramsAssumed === true,
      state: STATES.has(it.state) ? it.state : null,
      searchTerm: text(it.searchTerm) ?? name,
    }];
  });
}

/** The estimate step's JSON schema: per 100 g, kcal and grams, with what the estimate rests on. */
export const ESTIMATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kcal', 'protein', 'carbs', 'fat', 'fibre', 'sugars', 'salt', 'assumptions'],
        properties: {
          name: { type: 'string' },
          kcal: { type: 'number' },
          protein: { type: ['number', 'null'] },
          carbs: { type: ['number', 'null'] },
          fat: { type: ['number', 'null'] },
          fibre: { type: ['number', 'null'] },
          sugars: { type: ['number', 'null'] },
          salt: { type: ['number', 'null'] },
          assumptions: { type: 'string' },
        },
      },
    },
  },
};

const inRange = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

/**
 * The estimate step's items as foods (source 'estimate'), checked: kcal from 0 to 900 per 100 g
 * (else the item is dropped), each nutrient from 0 to 100 g (else unknown).
 */
export function cleanEstimate(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.flatMap((it) => {
    const name = text(it?.name);
    const kcal = inRange(it?.kcal, 900);
    if (!name || kcal == null) return [];
    const mg = (v) => {
      const g = inRange(v, 100);
      return g == null ? null : Math.round(g * 1000);
    };
    return [{
      name,
      brand: null,
      barcode: null,
      state: 'asSold',
      per100g: {
        kcalTenths: Math.round(kcal * 10),
        proteinMg: mg(it.protein),
        carbsMg: mg(it.carbs),
        fatMg: mg(it.fat),
        fibreMg: mg(it.fibre),
        sugarsMg: mg(it.sugars),
        saltMg: mg(it.salt),
      },
      carbsIncludeFibre: false,
      servings: [],
      gramsPer100ml: 100,
      source: 'estimate',
      sourceId: null,
      assumptions: text(it.assumptions),
    }];
  });
}

/** Only items nothing suitable matched are estimated. */
export const needsEstimate = (lines) => lines.filter((l) => !l.food);

/** 'estimate' for an estimated food, else 'database' (a source or your own food). */
export const nutritionBasisFor = (food) => (food?.source === 'estimate' ? 'estimate' : 'database');

/** A photo's portions, and amounts the sentence didn't give, are guessed until you change them. */
export const portionBasisFor = ({ gramsAssumed, origin }) => (origin === 'photo' || gramsAssumed ? 'guessed' : 'typed');

/** A check sheet line from a parsed item and its matched (or estimated) food. */
export function checkLine(item, food, { origin = 'sentence' } = {}) {
  return {
    name: item.name,
    food,
    grams: item.grams,
    portionBasis: portionBasisFor({ gramsAssumed: item.gramsAssumed, origin }),
  };
}

/** Editing a line's grams makes its portion typed. */
export const withGrams = (line, grams) => ({ ...line, grams, portionBasis: 'typed' });

/** What's uncertain about a line, for the check sheet. */
export function uncertainty(line) {
  const out = [];
  if (line.food?.source === 'estimate') out.push('~ Estimated nutrition');
  if (line.portionBasis === 'guessed') out.push('~ Portion guessed');
  return out;
}
