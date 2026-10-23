// Foods: My Foods (yours, most used first, with a search), Saved Meals, and Recipes. Each item
// opens its sheet; adding is the text button above each list.

import { h, fill, segmented } from './dom.js';
import { foodSub } from './format.js';
import { openFoodSheet } from './food-sheet.js';
import { openSavedMealSheet, savedMealSub } from './saved-meal-sheet.js';
import { openRecipeSheet, openRecipeEditor, recipeSub } from './recipe-sheets.js';
import { myFoods, isLive, nameCase } from '../engine/index.js';

const SHOWN = 50;
const byName = (a, b) => a.name.localeCompare(b.name, 'en-GB');

// The view and search are kept while you move between tabs.
let view = 'foods';
let query = '';

export function renderFoods(root, { repo }) {
  const S = repo.state;
  const body = h('div', { class: 'section' });
  const search = h('input', {
    class: 'input', type: 'search', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search your foods',
    placeholder: 'Search your foods', value: query, oninput: () => { query = search.value; renderList(); },
  });
  const list = h('div', { class: 'section' });
  const toggle = segmented({
    label: 'Show',
    options: [{ value: 'foods', label: 'My Foods' }, { value: 'meals', label: 'Saved Meals' }, { value: 'recipes', label: 'Recipes' }],
    value: view,
    onChange: (v) => { view = v; render(); },
  });
  fill(root, h('div', { class: 'screen' }, toggle, body));

  const row = (title, sub, onclick, amount = null) => h('li', {},
    h('button', { type: 'button', class: 'list-row', onclick },
      h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, title), sub && h('span', { class: 'list-sub' }, sub)),
      amount && h('span', { class: 'list-amount' }, amount)));
  const addButton = (label, onclick) => h('div', {}, h('button', { type: 'button', class: 'text-button', onclick }, label));

  function foodsList() {
    const foods = myFoods(S.foods, query);
    if (!S.foods.some(isLive)) return h('p', { class: 'empty-line' }, 'Foods you log or add appear here, most used first.');
    if (!foods.length) return h('p', { class: 'empty-line' }, 'None of your foods match. Try fewer words.');
    return [
      h('ul', { class: 'list', 'aria-label': 'Your foods' }, foods.slice(0, SHOWN).map((f) => row(nameCase(f.name), foodSub(f), () => openFoodSheet({ repo, food: f })))),
      foods.length > SHOWN && h('p', { class: 'reason' }, `${foods.length - SHOWN} more. Search to find them.`),
    ];
  }

  function renderList() {
    if (view === 'foods') return fill(list, foodsList());
    if (view === 'meals') {
      const meals = S.savedMeals.filter(isLive).sort(byName);
      return fill(list, meals.length
        ? h('ul', { class: 'list', 'aria-label': 'Saved meals' }, meals.map((m) => row(nameCase(m.name), savedMealSub(m, S), () => openSavedMealSheet({ repo, savedMeal: m }))))
        : h('p', { class: 'empty-line' }, 'Save a meal you eat often, and log it from Log in one tap.'));
    }
    const recipes = S.recipes.filter(isLive).sort(byName);
    return fill(list, recipes.length
      ? h('ul', { class: 'list', 'aria-label': 'Recipes' }, recipes.map((r) => row(nameCase(r.name), recipeSub(r, S), () => openRecipeSheet({ repo, recipe: r }))))
      : h('p', { class: 'empty-line' }, 'Add a dish you cook in batches. Weigh it once, then log it by grams or portions.'));
  }

  function render() {
    toggle.set(view);
    if (view === 'foods') fill(body, search, addButton('Add a Food', () => openFoodSheet({ repo })), list);
    else if (view === 'meals') fill(body, addButton('Add a Saved Meal', () => openSavedMealSheet({ repo })), list);
    else fill(body, addButton('Add a Recipe', () => openRecipeEditor({ repo })), list);
    renderList();
  }

  render();
  return { refresh: () => renderList() };
}
