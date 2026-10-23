// Wording helpers.

/** Short joining words that stay lower case in title case, unless first or last. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'with']);

/**
 * Title case for controls (buttons, labels, chips): "Add an account" → "Add an Account".
 * Only first letters are raised, so acronyms, amounts and names keep their own case ("Sync IBKR Now").
 */
export function titleCase(text) {
  const words = String(text ?? '').split(' ');
  return words.map((w, i) => {
    const small = i > 0 && i < words.length - 1 && SMALL_WORDS.has(w);
    return small ? w : w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/** Units that stay lower case inside a name ("Coke 330 ml"). */
const UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l', 'cl', 'kcal']);

/**
 * A food, meal, recipe or activity name as shown: title case, whatever case its source used.
 * "Fanta fruit twist" and "FANTA FRUIT TWIST" both show as "Fanta Fruit Twist". All-caps words of
 * four letters or more are lowered first; shorter ones are kept as acronyms ("KFC", "M&S", "BBQ").
 * Each part of a hyphenated word is raised ("Coca-Cola"), and units stay lower case.
 */
export function nameCase(text) {
  const words = String(text ?? '').trim().split(/\s+/);
  const raise = (p) => p.replace(/^([^\p{L}\p{N}]*)(\p{Ll})/u, (_, lead, c) => lead + c.toUpperCase());
  return words.map((w, i) => {
    const lower = w.toLowerCase();
    if (UNITS.has(lower)) return lower;
    if (SMALL_WORDS.has(lower)) return i > 0 && i < words.length - 1 ? lower : raise(lower);
    return w.split('-').map((part) => {
      const letters = part.replace(/[^\p{L}]/gu, '');
      return raise(letters.length > 3 && letters === letters.toUpperCase() ? part.toLowerCase() : part);
    }).join('-');
  }).join(' ');
}
