# Proposal: data model, API and engine

For your OK before Stage 1. Once agreed, the typedefs go into `src/db/schema.js`, the tables into `worker/schema.sql`, and the choices into `docs/decisions.md`. Items marked **(new)** aren't in SPEC.md or differ from it.

## 1. Units

| Quantity | Stored as | Where |
|---|---|---|
| Food amount | integer grams | entries, recipe lines, batches, pots |
| Nutrition per 100 g | integer tenths of a kcal; integer mg for protein, carbs, fat, fibre, sugars and salt | foods, the source cache |
| Nutrition of an amount **(new)** | integer thousandths of a kcal (`kcalMilli`); integer µg | entries, batch totals |
| Body weight | integer grams | weights |
| Liquids | `gramsPer100ml` integer, default 100 **(new: replaces `mlToGrams`, so it stays an integer)** | foods |

Why amounts get finer units: per-100 g × grams lands exactly on them (`kcalMilli = kcalTenths × grams`, `µg = mg × grams × 10`), so logging a food never rounds. The only rounding before display is splitting a batch into portions, at µg, with the remainder in the last portion. Display rounds once: kcal = round(Σ kcalMilli ÷ 1000), grams = round(Σ µg ÷ 1,000,000). The largest entry (5,000 g of pure fat) is 5 × 10⁹ µg, well inside JS and SQLite integers.

```js
/** @typedef {Object} Per100g    each an integer, or null when the source doesn't give it
 *  @property {number|null} kcalTenths
 *  @property {number|null} proteinMg  carbsMg  fatMg  fibreMg  sugarsMg  saltMg */

/** @typedef {Object} Amounts    nutrition of an amount: each an integer, or null when unknown
 *  @property {number|null} kcalMilli
 *  @property {number|null} proteinUg  carbsUg  fatUg  fibreUg  sugarsUg  saltUg
 *  @property {string[]} partial          fields that are a sum leaving out an unknown (a batch with one ingredient's fibre unknown)
 *  @property {boolean} carbsIncludeFibre  copied from the food: "Carbs may include fibre." */
```

## 2. Tables

Every synced row also has `id` (client UUID unless stated), `updatedAt`, `deletedAt` and `rev`, as in Mateen Money: one change counter, soft deletes, `GET /sync?since=rev`. Field names are camelCase in JS, JSON and D1. JSON columns are marked *json*.

### Synced (D1 and the phone's IndexedDB)

| Table | Fields | Notes |
|---|---|---|
| `foods` | name, brand, barcode, state (`raw`/`cooked`/`asSold`), per100g *json*, carbsIncludeFibre, servings *json* `[{ label, grams }]`, gramsPer100ml, source (`off`/`cofid`/`usda`/`custom`/`estimate`), sourceId, fetchedAt, assumptions, usualGrams, useCount, lastUsedAt, userEdited | Your foods: ones you've logged, made or edited. A source food becomes a row here the first time it's logged. One live row per `source:sourceId`. |
| `entries` | date, meal, foodId, batchId, name, grams, nutrition *json* (Amounts), nutritionBasis (`database`/`estimate`/`quick`), portionBasis (`weighed`/`typed`/`serving`/`guessed`), assumptions, status (`logged`/`toCheck`), origin (`manual`/`sentence`/`photo`/`shortcut`/`quick`), createdAt | Copied at logging, never recalculated. Quick add has no foodId; grams null. |
| `savedMeals` | name, items *json* `[{ foodId, grams }]` | |
| `recipes` | name, ingredients *json* `[{ foodId, grams }]` | |
| `batches` | recipeId, date, ingredients *json* `[{ foodId, name, state, grams, nutrition }]`, totals *json* (Amounts plus `estimated`), weighedGrams, potId, finishedGrams, portions | finishedGrams = sum of ingredients, or weighedGrams less the pot. Ingredients carry copied nutrition so editing a food never changes a batch. **(new: weighedGrams)** |
| `pots` | name, grams | |
| `days` | state (`complete`/`incomplete`) | id = the date. No row means unreviewed. |
| `targets` **(new)** | fromDate, mode (`fixed`/`adaptive`), kcal, proteinG, carbsG, fatG, goalRateG | id = fromDate. A day's target is the latest row on or before it, so a change never rewrites past days' "against target" figures. This is Mateen Money's budgets pattern. The weekly review writes one when you tap "Use 2,050 kcal". |
| `weights` | date, grams, source (`manual`/`health`/`import`) | id = the date, so the latest of the day wins. |
| `activity` | date, activeKcal, steps, source | id = the date; `/health` replaces it. |
| `workouts` | date, start, type, minutes, kcal, source (`health`/`manual`), activityId | Health ones have id `health:<start>:<type>`, so a rerun adds nothing. Manual ones have a MET activity id from `data/activities.json`. |
| `reviews` **(new)** | weekStart, completedAt | id = the Monday. Shows the card "until completed" and counts the weeks in a row. |
| `settings` | value *json* | See below. |

### Worker only (not synced)

| Table | Fields | Notes |
|---|---|---|
| `meta` | key, value | rev, seeded |
| `sourceFoods` **(new)** | id `<source>:<sourceId>`, source, sourceId, name, nameNorm, brand, barcode, state, per100g *json*, carbsIncludeFibre, servings *json*, fetchedAt | The cache: CoFID's import, plus every Open Food Facts and USDA food looked up. Search uses `nameNorm`. |
| `parseCalls` **(new)** | calls | The cost guard. id = the Worker's own UTC date. Checked and incremented in one statement before each model call: `INSERT INTO parseCalls (id, calls) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET calls = calls + 1 WHERE calls < 100 RETURNING calls`. No row back means the cap is reached. |
| `searchCache` **(new)** | source, queryNorm, sourceFoodIds *json*, fetchedAt | id `<source>:<queryNorm>`. A query asked again within 7 days is answered from here and `sourceFoods`, without asking Open Food Facts or USDA. |

### Settings rows

`floorKcal` (1500), `exerciseAddBackPct` (50), `mealTimes` (`{ lunch: '11:00', dinner: '17:00', snacks: '21:00' }`; breakfast from 04:00), `weightUnit` (`kg`), `sources` (`{ off, cofid, usda }`, each on). The mode, the goal rate (`goalRateG`: −750, −500, −250, 0 or 250 g a week) and the targets themselves are only in `targets`. The token and the last-synced time stay on the phone (`meta` in IndexedDB), as in Mateen Money.

## 3. Routes

Every route needs `Authorization: Bearer <API_TOKEN>`; there is no unauthenticated route. JSON writes reply `{ rev, changes }`. Shortcut routes reply with one line of text for a notification. Errors start "Nothing changed:".

| Route | Request | Reply |
|---|---|---|
| `GET /sync?since=rev` | | `{ rev, changes: { table: [row] } }` |
| `PUT /:table/:id` | the row's fields | `{ rev, changes }`. A body whose `id` differs from the URL's is refused with 400 and nothing changes. Saving an entry also updates its food's usualGrams, useCount and lastUsedAt in the same write. |
| `DELETE /:table/:id` | | `{ rev, changes }` (soft delete; Undo is a PUT with `deletedAt: null`) |
| `POST /batch` | `{ foods?, entries?, batches?, days?, ... }` with ids | `{ rev, changes }`, all or nothing. Used for "Log 3 Items" (new foods and their entries together), Copy to Today and "Mark N Days Complete". |
| `GET /search?q=` | | `{ results: [Food] }` from the cache, then Open Food Facts and USDA. The phone sends it after a pause in typing (about 400 ms), not on every keystroke. Recent queries are cached (`searchCache`) as well as the foods found, so a repeat asks neither source. Your own foods are searched on the phone, so they come first and work offline. |
| `GET /barcode/:code` | | `{ food: Food \| null }` from the cache, else Open Food Facts |
| `POST /parse` | `{ text }` or `{ image: { mediaType, data } }` (base64 JPEG, ≤ 1,024 px) | `{ items: [{ name, quantity, unit, grams, gramsAssumed, state, food, matchedFrom, alternatives }], callsLeft }`. Steps 1 to 3 run on the Worker in one request. `food` is a matched or estimated food without an id; the phone gives it one when you log. The parse call and the estimate call each count against the cost guard. |
| `POST /log` | `{ text, timestamp }` (the sentence Shortcut) | Text: "3 items to check: eggs, toast, flat white." Entries are saved as `toCheck`, origin `shortcut`, with ids from the timestamp, so a retry adds nothing. Its model calls count against the cost guard too. |
| `POST /health` | `{ date, activeKcal, steps, weightKg, workouts: [{ start, type, minutes, kcal }] }` | Text: "Synced 12 Oct: 480 active kcal, 9,120 steps, 72.4 kg." |
| `GET /summary?date=` / `POST /summary` | `{ timestamp }` | Text: the weekly summary |
| `POST /restore` | a backup file | `{ rev, count }`, all or nothing |

The Claude call (Stage 2) asks for JSON through `output_config.format` (a JSON schema), at low effort, with your 30 most-logged foods in the prompt. The Worker validates what comes back: grams over 0 and at most 5,000 (otherwise grams are left blank for you to enter), unknown fields dropped, and no nutrition accepted from the parse step. A `refusal` stop reason gets "Nothing changed: …", and Haiku has no fallback model. Before every model call, the Worker takes one of the day's 100 with the `parseCalls` statement above; if none is left, it makes no call.

## 4. Engine modules (`src/engine/`)

Stage 1, each with tests for its named rules:

| Module | What it does |
|---|---|
| `dates.js` | Copied from Mateen Money: today, addDays, weekStart, formatDay, partsFromIso (a timestamp's own offset picks the date) |
| `text.js` | Copied: titleCase |
| `nutrition.js` | per100g → Amounts, sums that count unknowns ("Fibre unknown for 2 foods."), display rounding and formatting ("1,240 kcal", "58 g protein") |
| `sources.js` | Turns Open Food Facts, CoFID and USDA records into per-100 g integers: kJ ÷ 4.184, the source's own kcal, salt = sodium × 2.5, USDA carbs less fibre or marked carbsIncludeFibre. Shared by the Worker and the import script. |
| `parse.js` | Validates the parse and estimate output; turns items into entries with nutritionBasis and portionBasis (guessed becomes typed when edited) |
| `entries.js` | Entry from a food and grams, from a serving, from quick add; food memory (usual grams) |
| `meals.js` | Meal slot from the time; quick-log chip order by use in the current slot |
| `recipes.js` | Batch totals carrying unknowns and estimates, finished weight (sum / weighed less pot), per-gram and per-portion with the remainder in the last, grams left (never below zero) |
| `exercise.js` | (MET − 1) × kg × hours; a day's exercise (Health active energy wins over manual workouts) |
| `weight.js` | Trend weight (α = 0.1 a day, carried across gaps); kg / st lb |
| `maintenance.js` | 28-day estimate from complete days, the minimums (14 days, 8 weigh-ins) and "Log 6 more complete days…", the 150 kcal weekly cap, worked out week by week from the data so nothing extra is stored |
| `targets.js` | A day's target: fixed plus exercise added back, or adaptive (estimate ± rate × 7,700 ÷ 7), never below the floor |
| `headline.js` | "~1,240 kcal left today." / "180 kcal over today.", protein to go, To check counted as estimates |
| `days.js` | Complete / incomplete / unreviewed; days under 60% of their target |
| `summary.js` | The week Monday to Sunday: average of complete days, protein days, trend change, To check and unreviewed counts, and the text |
| `draft.js` | The Log draft (copied pattern) |
| `export.js` | Backup check and CSV |
| `index.js` | Re-exports |

Later stages add `overview.js` (5), `history.js` (6) and `review.js` (7). The Worker's `/health` handling (Stage 2) uses `exercise.js`, `nutrition.js` and `summary.js`, so it adds no engine module of its own.
