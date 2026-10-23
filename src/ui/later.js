// Screens built in later stages: a plain line saying so, until then.

import { h, fill } from './dom.js';

const STAGES = { history: 6 };

export const renderLater = (name) => (root) => {
  fill(root, h('div', { class: 'empty' }, h('p', {}, `This screen is built in Stage ${STAGES[name]}.`)));
  return {};
};
