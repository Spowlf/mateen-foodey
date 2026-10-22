// Turning a source's record into a food with per-100 g integers, once, when it's cached.
// Shared by the Worker (Open Food Facts and USDA lookups) and scripts/import-cofid.js.
//
// - Energy is the source's own kcal, never worked out from the macros. Given only in kJ: kJ ÷ 4.184.
// - Carbs follow UK / EU labels, fibre excluded. USDA's carbs (by difference) include fibre, so fibre
//   is taken off when it's known; when it isn't, carbs stay as given and the food is marked carbsIncludeFibre.
// - Salt given only as sodium: salt = sodium × 2.5.
// - A value the source doesn't give is null.

import { unknownPer100g } from './nutrition.js';

export const KJ_PER_KCAL = 4.184;
export const SALT_PER_SODIUM = 2.5;

/** A number from a source field, or null for blanks, text and negatives. */
function value(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const tenths = (kcal) => (kcal == null ? null : Math.round(kcal * 10));
const mg = (g) => (g == null ? null : Math.round(g * 1000));

export const kjToKcalTenths = (kj) => (kj == null ? null : Math.round((kj * 10) / KJ_PER_KCAL));

/** Tenths of a kcal: the kcal given, else from kJ. */
export const energyTenths = ({ kcal = null, kj = null }) => (kcal != null ? tenths(kcal) : kjToKcalTenths(kj));

export const saltFromSodiumMg = (sodiumMg) => (sodiumMg == null ? null : Math.round(sodiumMg * SALT_PER_SODIUM));

/** Raw, cooked or as sold, from words in a name ("Rice, white, boiled" → cooked). */
export function stateFromName(name) {
  const s = String(name ?? '').toLowerCase();
  if (/\b(boiled|fried|grilled|roasted|roast|baked|cooked|steamed|stewed|poached|microwaved|braised|toasted|scrambled)\b/.test(s)) return 'cooked';
  if (/\braw\b/.test(s)) return 'raw';
  return 'asSold';
}

const food = (fields) => ({
  name: null, brand: null, barcode: null, state: 'asSold', per100g: unknownPer100g(), carbsIncludeFibre: false,
  servings: [], gramsPer100ml: 100, assumptions: null, ...fields,
});

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** An Open Food Facts product (API v2 `product`). UK labels already leave fibre out of carbs. */
export function fromOff(product) {
  const n = product?.nutriments ?? {};
  const sodiumMg = mg(value(n.sodium_100g));
  const saltG = value(n.salt_100g);
  const servingGrams = value(product?.serving_quantity);
  const servingUnit = product?.serving_quantity_unit;
  const servings = servingGrams && (!servingUnit || servingUnit === 'g') && text(product?.serving_size)
    ? [{ label: text(product.serving_size), grams: Math.round(servingGrams) }]
    : [];
  return food({
    name: text(product?.product_name_en) ?? text(product?.product_name) ?? text(product?.generic_name),
    brand: text(String(product?.brands ?? '').split(',')[0]),
    barcode: text(product?.code),
    // energy_100g is in kJ.
    per100g: {
      kcalTenths: energyTenths({ kcal: value(n['energy-kcal_100g']), kj: value(n['energy-kj_100g']) ?? value(n.energy_100g) }),
      proteinMg: mg(value(n.proteins_100g)),
      carbsMg: mg(value(n.carbohydrates_100g)),
      fatMg: mg(value(n.fat_100g)),
      fibreMg: mg(value(n.fiber_100g)),
      sugarsMg: mg(value(n.sugars_100g)),
      saltMg: saltG != null ? mg(saltG) : saltFromSodiumMg(sodiumMg),
    },
    servings,
    source: 'off',
    sourceId: text(product?.code),
  });
}

/**
 * A CoFID value: "Tr" (trace) is 0; "N" (present but not measured) and blanks are unknown.
 */
export function cofidValue(v) {
  if (typeof v === 'string' && /^tr$/i.test(v.trim())) return 0;
  return value(v);
}

/**
 * A CoFID row, with its columns already named by scripts/import-cofid.js:
 * { code, name, kcal, kj, protein, carbohydrate, fat, fibre, sugars, sodium } in g per 100 g (sodium in mg).
 * fibre is AOAC fibre, the method UK labels use.
 */
export function fromCofid(row) {
  const name = text(row?.name);
  return food({
    name,
    state: stateFromName(name),
    per100g: {
      kcalTenths: energyTenths({ kcal: cofidValue(row?.kcal), kj: cofidValue(row?.kj) }),
      proteinMg: mg(cofidValue(row?.protein)),
      carbsMg: mg(cofidValue(row?.carbohydrate)),
      fatMg: mg(cofidValue(row?.fat)),
      fibreMg: mg(cofidValue(row?.fibre)),
      sugarsMg: mg(cofidValue(row?.sugars)),
      saltMg: saltFromSodiumMg(cofidValue(row?.sodium)),
    },
    source: 'cofid',
    sourceId: text(row?.code),
  });
}

// USDA nutrient numbers. Foundation foods give energy as Atwater kcal (958, 957) instead of 208.
const USDA = {
  kcal: ['208', '958', '957'], kj: ['268'], protein: ['203'], fat: ['204'], carbs: ['205'],
  fibre: ['291'], sugars: ['269', '2000'], sodiumMg: ['307'],
};

/** A food's nutrient amounts by number, from either the details or the search shape. */
function usdaAmounts(item) {
  const out = new Map();
  for (const fn of item?.foodNutrients ?? []) {
    const number = String(fn?.nutrient?.number ?? fn?.nutrientNumber ?? '');
    const amount = value(fn?.amount ?? fn?.value);
    if (number && amount != null && !out.has(number)) out.set(number, amount);
  }
  return out;
}

const first = (amounts, numbers) => {
  for (const n of numbers) if (amounts.has(n)) return amounts.get(n);
  return null;
};

/** A USDA FoodData Central food (details or search result). Amounts are per 100 g. */
export function fromUsda(item) {
  const a = usdaAmounts(item);
  const fibreMg = mg(first(a, USDA.fibre));
  const carbsMg = mg(first(a, USDA.carbs));
  const name = text(item?.description);
  const servingGrams = item?.servingSizeUnit?.toLowerCase?.() === 'g' ? value(item?.servingSize) : null;
  return food({
    name,
    brand: text(item?.brandName) ?? text(item?.brandOwner),
    barcode: text(item?.gtinUpc),
    state: stateFromName(name),
    per100g: {
      kcalTenths: energyTenths({ kcal: first(a, USDA.kcal), kj: first(a, USDA.kj) }),
      proteinMg: mg(first(a, USDA.protein)),
      carbsMg: carbsMg != null && fibreMg != null ? Math.max(0, carbsMg - fibreMg) : carbsMg,
      fatMg: mg(first(a, USDA.fat)),
      fibreMg,
      sugarsMg: mg(first(a, USDA.sugars)),
      saltMg: saltFromSodiumMg(first(a, USDA.sodiumMg)),
    },
    carbsIncludeFibre: carbsMg != null && fibreMg == null,
    servings: servingGrams ? [{ label: text(item?.householdServingFullText) ?? `${Math.round(servingGrams)} g`, grams: Math.round(servingGrams) }] : [],
    source: 'usda',
    sourceId: item?.fdcId == null ? null : String(item.fdcId),
  });
}
