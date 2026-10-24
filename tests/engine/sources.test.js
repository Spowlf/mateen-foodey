import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromOff, fromCofid, fromUsda, fromSgFoodId, sgFoodIdValue, kjToKcalTenths, saltFromSodiumMg, cofidValue, stateFromName } from '../../src/engine/sources.js';
import { amountsFor, kcalOf, gramsOf } from '../../src/engine/nutrition.js';

// A UK loaf as Open Food Facts gives it. Its macros would come to 227 kcal; the label says 233.
const LOAF = {
  code: '5010029000016',
  product_name: 'Soft White Medium',
  brands: 'Hovis, Premier Foods',
  serving_size: '1 slice (40 g)',
  serving_quantity: 40,
  nutriments: {
    'energy-kcal_100g': 233, 'energy-kj_100g': 986, energy_100g: 986, proteins_100g: 8.4, carbohydrates_100g: 43.4,
    fat_100g: 1.6, fiber_100g: 2.8, sugars_100g: 3.4, salt_100g: 0.88, sodium_100g: 0.352,
  },
};

test('import, Open Food Facts: a UK packaged food, per 100 g and for a slice', () => {
  const f = fromOff(LOAF);
  assert.deepEqual(f.per100g, { kcalTenths: 2330, proteinMg: 8400, carbsMg: 43400, fatMg: 1600, fibreMg: 2800, sugarsMg: 3400, saltMg: 880 });
  assert.deepEqual([f.name, f.brand, f.barcode, f.state, f.source, f.sourceId], ['Soft White Medium', 'Hovis', '5010029000016', 'asSold', 'off', '5010029000016']);
  assert.deepEqual(f.servings, [{ label: '1 slice (40 g)', grams: 40 }]);
  assert.equal(f.carbsIncludeFibre, false);
  const slice = amountsFor(f.per100g, 40);
  assert.equal(kcalOf(slice.kcalMilli), 93);   // 93.2
  assert.equal(gramsOf(slice.proteinUg), 3);   // 3.36
});

test('energy: the source’s kcal is used, never worked out from the macros', () => {
  assert.equal(fromOff(LOAF).per100g.kcalTenths, 2330);
});

test('energy: given only in kJ, kcal = kJ ÷ 4.184', () => {
  assert.equal(kjToKcalTenths(418.4), 1000);
  assert.equal(kjToKcalTenths(1000), 2390);    // 239.0 kcal
  const kjOnly = fromOff({ code: '1', product_name: 'Squash', nutriments: { energy_100g: 1000 } });
  assert.equal(kjOnly.per100g.kcalTenths, 2390);
});

test('salt: from sodium × 2.5 when the source gives only sodium', () => {
  assert.equal(saltFromSodiumMg(400), 1000);
  const f = fromOff({ code: '2', product_name: 'Crisps', nutriments: { 'energy-kcal_100g': 520, sodium_100g: 0.4 } });
  assert.equal(f.per100g.saltMg, 1000);
  assert.equal(f.per100g.proteinMg, null);    // not given: unknown, not 0
});

test('import, CoFID: per 100 g and for 40 g; trace is 0, not measured is unknown', () => {
  const f = fromCofid({ code: '11-001', name: 'Porridge oats, unfortified, raw', kcal: '375', kj: '1587', protein: '11.2', carbohydrate: '60.4', fat: '8.0', fibre: '9.0', sugars: 'Tr', sodium: 'N' });
  assert.deepEqual(f.per100g, { kcalTenths: 3750, proteinMg: 11200, carbsMg: 60400, fatMg: 8000, fibreMg: 9000, sugarsMg: 0, saltMg: null });
  assert.deepEqual([f.state, f.source, f.sourceId], ['raw', 'cofid', '11-001']);
  const portion = amountsFor(f.per100g, 40);
  assert.equal(kcalOf(portion.kcalMilli), 150);
  assert.equal(portion.saltUg, null);
  assert.equal(cofidValue('Tr'), 0);
  assert.equal(cofidValue('N'), null);
  assert.equal(cofidValue(''), null);
});

test('import, CoFID: salt from sodium in mg', () => {
  assert.equal(fromCofid({ code: '1', name: 'Cheddar', kcal: '416', sodium: '670' }).per100g.saltMg, 1675);
});

const EGG_USDA = {
  fdcId: 171287,
  description: 'Egg, whole, raw, fresh',
  foodNutrients: [
    { nutrient: { number: '208' }, amount: 143 }, { nutrient: { number: '203' }, amount: 12.56 }, { nutrient: { number: '204' }, amount: 9.51 },
    { nutrient: { number: '205' }, amount: 0.72 }, { nutrient: { number: '291' }, amount: 0 }, { nutrient: { number: '269' }, amount: 0.37 },
    { nutrient: { number: '307' }, amount: 142 },
  ],
};

test('import, USDA: per 100 g and for 50 g', () => {
  const f = fromUsda(EGG_USDA);
  assert.deepEqual(f.per100g, { kcalTenths: 1430, proteinMg: 12560, carbsMg: 720, fatMg: 9510, fibreMg: 0, sugarsMg: 370, saltMg: 355 });
  assert.deepEqual([f.state, f.source, f.sourceId], ['raw', 'usda', '171287']);
  assert.equal(kcalOf(amountsFor(f.per100g, 50).kcalMilli), 72);   // 71.5 rounds up
});

test('USDA carbs: fibre taken off when it is known', () => {
  const f = fromUsda({ fdcId: 1, description: 'Bread, wholemeal', foodNutrients: [{ nutrientNumber: '208', value: 250 }, { nutrientNumber: '205', value: 41.3 }, { nutrientNumber: '291', value: 6.8 }] });
  assert.equal(f.per100g.carbsMg, 34500);
  assert.equal(f.per100g.fibreMg, 6800);
  assert.equal(f.carbsIncludeFibre, false);
});

test('USDA carbs: kept and marked when fibre is missing', () => {
  const f = fromUsda({ fdcId: 2, description: 'Rice, white, cooked', foodNutrients: [{ nutrientNumber: '208', value: 130 }, { nutrientNumber: '205', value: 28.17 }] });
  assert.equal(f.per100g.carbsMg, 28170);
  assert.equal(f.per100g.fibreMg, null);
  assert.equal(f.carbsIncludeFibre, true);
  assert.equal(f.state, 'cooked');
});

test('USDA energy: Atwater kcal when 208 is missing, kJ last', () => {
  assert.equal(fromUsda({ fdcId: 3, description: 'Apple, raw', foodNutrients: [{ nutrientNumber: '958', value: 61.3 }] }).per100g.kcalTenths, 613);
  assert.equal(fromUsda({ fdcId: 4, description: 'Juice', foodNutrients: [{ nutrientNumber: '268', value: 418.4 }] }).per100g.kcalTenths, 1000);
});

test('state from a name', () => {
  assert.equal(stateFromName('Chicken breast, grilled'), 'cooked');
  assert.equal(stateFromName('Chicken breast, raw'), 'raw');
  assert.equal(stateFromName('Baked beans in tomato sauce'), 'cooked');
  assert.equal(stateFromName('Cornflakes'), 'asSold');
});

// Two foods as SG FoodID's details give them: a dish and a drink.
const CHICKEN_RICE = {
  crId: 'F05100133', name: 'Steamed chicken rice', category: 'Food', defaultWeight: 346, defaultPortion: '1 plate(s) = 346g', alternativePortions: '-',
  baseFoodNutrients: { energy: 147, protein: 5.95, fat: 3.6, carbohydrate: 21.88, sugar: -1, dietaryFibre: 1.57, sodium: 380 },
};
const KOPI = {
  crId: 'D09010035', name: 'Kopi', category: 'Drink', defaultWeight: 250, defaultPortion: '1 regular cup(s) = 250ml', alternativePortions: '1 large cup(s) = 300ml',
  baseFoodNutrients: { energy: 77, protein: 0.65, fat: 2.18, carbohydrate: 13.73, sugar: 7.62, dietaryFibre: null, sodium: null },
};

test('import, SG FoodID: per 100 g with trace as 0 and no data as unknown, and its portions', () => {
  const rice = fromSgFoodId(CHICKEN_RICE);
  assert.deepEqual(rice.per100g, { kcalTenths: 1470, proteinMg: 5950, carbsMg: 21880, fatMg: 3600, fibreMg: 1570, sugarsMg: 0, saltMg: 950 });
  assert.deepEqual([rice.name, rice.state, rice.source, rice.sourceId, rice.carbsIncludeFibre], ['Steamed chicken rice', 'cooked', 'sgfoodid', 'F05100133', false]);
  assert.deepEqual(rice.servings, [{ label: '1 plate', grams: 346 }]);
  const kopi = fromSgFoodId(KOPI);
  assert.deepEqual([kopi.per100g.fibreMg, kopi.per100g.saltMg, kopi.per100g.sugarsMg], [null, null, 7620]);
  // A drink's portions are in ml, taken as grams, as its figures per 100 ml are taken per 100 g.
  assert.deepEqual(kopi.servings, [{ label: '1 regular cup', grams: 250 }, { label: '1 large cup', grams: 300 }]);
});

test('import, SG FoodID: portion labels without "(s)" or brackets, and odd values left out', () => {
  const f = (defaultPortion, alternativePortions = '-') => fromSgFoodId({ ...KOPI, defaultPortion, alternativePortions }).servings;
  assert.deepEqual(f('1 cup (200ml) = 200ml'), [{ label: '1 cup', grams: 200 }]);
  assert.deepEqual(f('2 piece(s) = 53.4g', '1 bowl(s) = 300g; 1 small bowl(s) = 150g'), [{ label: '2 pieces', grams: 53 }, { label: '1 bowl', grams: 300 }, { label: '1 small bowl', grams: 150 }]);
  assert.deepEqual(f('-'), []);
  assert.deepEqual(fromSgFoodId({ ...KOPI, baseFoodNutrients: { energy: 'None', protein: -1 } }).per100g.kcalTenths, null);
  assert.equal(sgFoodIdValue(-1), 0);
  assert.equal(sgFoodIdValue(null), null);
  assert.equal(sgFoodIdValue('None'), null);
  assert.equal(sgFoodIdValue(-5), null);
});
