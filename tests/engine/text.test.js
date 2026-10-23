import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCase, nameCase } from '../../src/engine/text.js';

test('title case for controls keeps joining words low and other case as typed', () => {
  assert.equal(titleCase('log to lunch'), 'Log to Lunch');
  assert.equal(titleCase('sync IBKR now'), 'Sync IBKR Now');
});

test('names show in title case whatever case their source used', () => {
  assert.equal(nameCase('Fanta fruit twist'), 'Fanta Fruit Twist');
  assert.equal(nameCase('FANTA FRUIT TWIST'), 'Fanta Fruit Twist');
  assert.equal(nameCase('Porridge Oats'), 'Porridge Oats');
  assert.equal(nameCase('toast with butter'), 'Toast with Butter');
  assert.equal(nameCase('THE BEST BBQ SAUCE'), 'The Best BBQ Sauce');
  assert.equal(nameCase('KFC zinger burger'), 'KFC Zinger Burger');
  assert.equal(nameCase('M&S chicken tikka'), 'M&S Chicken Tikka');
  assert.equal(nameCase("McVitie's digestives"), "McVitie's Digestives");
  assert.equal(nameCase('coca-cola zero'), 'Coca-Cola Zero');
  assert.equal(nameCase('Coke 330 ML'), 'Coke 330 ml');
  assert.equal(nameCase('Poached chicken breast, 600 g, cooked'), 'Poached Chicken Breast, 600 g, Cooked');
  assert.equal(nameCase('Bread, white, sliced'), 'Bread, White, Sliced');
  assert.equal(nameCase('Run, 12 min a mile'), 'Run, 12 Min a Mile');
  assert.equal(nameCase('crème fraîche'), 'Crème Fraîche');
  assert.equal(nameCase('  flat   white '), 'Flat White');
  assert.equal(nameCase(''), '');
});
