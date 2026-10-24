# Spec

A personal calorie, macro and exercise tracker for one person in the UK. Food in grams, energy in kcal, body weight in kg (shown as kg or st lb). Design and conventions follow `HANDOVER.md`; dated choices are in `docs/decisions.md`.

## Moment of use

Right after eating, phone in one hand. A regular food or meal takes two taps; anything new takes one typed or dictated sentence (the iOS keyboard's dictation) and a check of the portions.

## Backend (single source of truth)

- Cloudflare Workers + D1. Every route needs the bearer token; CORS limits browsers to the GitHub Pages origin. The Worker validates every body and never logs the token or food data.
- Worker secrets: `API_TOKEN`, `ANTHROPIC_API_KEY`, `USDA_API_KEY`. Never in the repo.
- Food sources, called by the Worker: Open Food Facts (barcodes, branded UK foods; identifying User-Agent), CoFID (imported into D1 by `scripts/import-cofid.js`, which needs `--apply`), SG FoodID (Singapore's Health Promotion Board, imported by `scripts/import-sgfoodid.js`, which reads its website's JSON; its licence notice is in Settings), USDA FoodData Central. Search shows CoFID, then SG FoodID, then Open Food Facts, then USDA. Looked-up foods are cached in D1 with `fetchedAt`.
- **Idempotent saves**: client-generated ids, `PUT /<table>/:id`; a body whose `id` differs from the URL's is rejected.
- **Dates**: the phone decides. Entries carry the local date at logging; Shortcuts send the phone's date; summary requests send the phone's timestamp with its offset. The Worker never works out "today", except the cost guard's UTC day.
- **Offline**: service worker caches the app; IndexedDB caches the last sync; the app opens read-only with "Last synced [time]". Saving needs a connection. Log keeps one offline draft ("Not synced") that no app logic or failed request discards.
- **Backup**: JSON export and restore (all or nothing, confirm names the backup's date and record count); CSV export. The Worker validates the whole file first (JSON, required fields, duplicate ids, references between foods, recipes, batches, pots and entries), then writes one D1 batch. A rejected restore says "Nothing changed: …".

## Numbers and units

- Food amounts are integer grams. Liquids can be typed in ml; a food's `gramsPer100ml` defaults to 100.
- Nutrition per 100 g as integers: energy in tenths of a kcal; protein, carbs, fat, fibre, sugars and salt in mg. Converted once, when cached. Integer scaling, rounded once for display.
- **Unknown is not zero**: a missing nutrient is `null` everywhere, and totals say so ("Fibre unknown for 2 foods.").
- **Energy**: the source's own kcal, never recalculated from macros. kJ only: kcal = kJ ÷ 4.184. USDA: 208, then Atwater Specific (958), then Atwater General (957), then kJ.
- **Carbs** follow UK / EU labels, fibre excluded. USDA carbs become carbs − fibre when fibre is known; otherwise kept, fibre `null`, marked `carbsIncludeFibre` ("Carbs may include fibre.").
- **CoFID**: "Tr" is 0; "N" and blanks are unknown. Fibre is AOAC (unknown when only NSP is given). Carbs kept as given (monosaccharide equivalents, a few percent above labels for starchy foods).
- **SG FoodID**: "Trace" (-1) is 0; "no data" is unknown. Carbs already leave fibre out. Drinks' figures per 100 ml are taken per 100 g, and their ml portions as grams.
- **Open Food Facts**: as-sold (`_100g`) values only; prepared values are never mixed in.
- **Salt** from sodium only: sodium × 2.5.
- Body weight in integer grams.

## Data

- **Foods** `{ id, name, brand, barcode, state, per100g, carbsIncludeFibre, servings, gramsPer100ml, source, sourceId, fetchedAt, assumptions, usualGrams, useCount, lastUsedAt, userEdited }`. `state`: `raw`, `cooked` or `asSold`. `servings`: `[{ label, grams }]`. `source`: `off`, `cofid`, `usda`, `custom` or `estimate`. A source refresh never overwrites a food the user edited.
- **Entries** `{ id, date, meal, foodId, batchId, savedMealId, name, grams, nutrition, nutritionBasis, portionBasis, assumptions, status, origin, createdAt }`. Name, nutrition and assumptions are copied at logging and never recalculated.
  - `nutritionBasis`: `database`, `estimate` or `quick`. `portionBasis`: `weighed`, `typed`, `serving` or `guessed`.
  - `meal`: breakfast, lunch, dinner or snacks. `status`: `logged` or `toCheck`. `origin`: manual, sentence, photo, shortcut or quick.
- **Saved meals** `{ id, name, items: [{ foodId, grams } or { recipeId, grams }] }`; a recipe item serves from the latest batch.
- **Recipes**, **batches**: see Recipes. **Pots** remain only so old batches and backups restore.
- **Days** `{ date, state }`: `unreviewed`, `complete` or `incomplete`.
- **Weights** `{ id, date, grams, source }`, one per date. **Activity** `{ date, activeKcal, steps, source }`. **Workouts** `{ id, date, start, type, minutes, kcal, source }`.
- **Settings** as key/value rows.

## Logging

- **Headline** first on Log: "~1,240 kcal left today." or "180 kcal over today." in plain ink, never red; then "92 g protein to go." or "Protein target reached." Then Log a Saved Meal and the add field.
- **Saved meals**: "Log a Saved Meal" lists them; a tap logs one to the chosen meal, with Undo.
- **Sentence logging** ("two eggs, toast, flat white"), five steps:
  1. **Parse**: `POST /parse` sends the text to Claude Haiku 5.5 (`claude-haiku-5-5`) with the 30 most-logged foods. A JSON schema returns `[{ name, quantity, unit, grams, gramsAssumed, state, searchTerm }]`. No nutrition, except kcal the sentence itself gives ("Popeyes 2 piece 780 kcal"), logged as a quick add.
  2. **Match**: your foods, then the cache (CoFID, SG FoodID and foods looked up before), then Open Food Facts and USDA.
  3. **Estimate**: unmatched items only; per-100 g nutrition with its assumptions, saved as an `estimate` food.
  4. **Review**: the check sheet shows each match (tap to swap, or Estimate Instead via `POST /estimate`), grams on a number pad, kcal and macros, Remove, and what's uncertain ("~ Estimated nutrition", "~ Portion guessed"). Edited grams become `typed`. Button: "Log 3 Items".
  5. **Record**: entries with copied nutrition, bases and assumptions.
- **Photo**: the same steps from a photo resized to 1,024 px on the long edge. Portions are `guessed` until edited.
- **Search**: one field. Recipes you've made come first (a tap serves from the latest batch to the chosen meal), then your foods, then the sources, after a pause in typing. The Worker caches recent queries.
- **Barcode**: typed, or scanned (EAN-13, EAN-8, UPC-A, UPC-E) with BarcodeDetector or vendored ZXing; looked up on Open Food Facts.
- **Quick add**: kcal, optional macros and name.
- **Meal slot**: the time picks breakfast, lunch or dinner (starts editable in Settings; default 04:00 / 12:00 / 18:00). Snacks are picked by hand. Changeable on every entry.
- **Food memory**: each log updates the food's usual grams.
- **Copy**: an entry, a meal or a day to today.
- **To check**: unconfirmed entries, counted as estimates ("~"), at the top of Log; one tap confirms.
- **Cost guard**: parse and estimate calls both count; the 101st in a UTC day is refused ("Nothing changed: today's limit for sentence logging is used up. Search instead."). Check and count are one atomic D1 statement. The Anthropic Console has a spending limit too.

## Recipes

- **Recipe** `{ id, name, ingredients: [{ foodId, grams }] }`, added by sentence or search. Each line shows raw, cooked or as sold.
- **Batch** per making: `{ id, recipeId, date, ingredients, totals, finishedGrams, potId, portions }`. Making starts from the last batch's ingredients.
- Finished weight defaults to the ingredients' sum; "Weigh the Finished Dish" replaces it (zero the scales with the empty pot on).
- Logging from a batch: grams (totals ÷ finished weight) or portions (totals ÷ portions, remainder in the last).
- Batch totals carry unknowns and estimates; an estimated ingredient makes the batch "~".
- "~1,050 g left": finished weight less what's logged, never below zero.
- A recipe shows its total and one serving of 3, 4 or 5, from the last finished weight or the ingredients' sum.

## Exercise and Health

- **Sync Health Shortcut**: `POST /health { date, activeKcal, steps, weightKg, workouts }` replaces the date's activity, adds each workout once (by start and type; one you deleted stays deleted) and saves the weight, never replacing one typed in the app. Runs after the morning alarm, sending yesterday and today. `GET /health/weights?from=&to=` (at most 31 days) lists typed weights, which the Shortcut writes to Health on days Health has none. Setup: `docs/shortcuts.md`.
- **Manual exercise**: an activity from `data/activities.json` (Compendium MET values) and minutes. kcal = (MET − 1) × latest body kg × hours, marked "~". Not added on days with Health active energy.
- **Weight history**: `scripts/import-health-weights.js` uploads the Health export's weights once.

## Targets and weight

- **Goal**: lose 0.25, 0.5 or 0.75 kg a week; maintain; or gain 0.25 kg a week.
- **Mode**: fixed (typed target, exercise added back at the Settings percentage, default 50%) or adaptive (maintenance estimate ± rate × 7,700 ÷ 7, no exercise added back, changed only when accepted in the review).
- Never below the floor (default 1,500 kcal). Protein target in grams; carbs and fat optional.
- **Trend weight**: exponential moving average, α = 0.1 a day, carried across missing days. Trend first, reading second.
- **Maintenance estimate** = average intake on complete days in the last 28 − 7,700 × trend change (kg) ÷ days. Needs 14 complete days and 8 weigh-ins; until then says what's missing, each part only while needed ("Log 6 more complete days and add 2 more weigh-ins."). Moves at most 150 kcal a week. Shown as "~2,350 kcal, from 21 complete days and your weight trend."

## Honest gaps

- Each past day is unreviewed until marked complete or incomplete (in the review or History). Today is never marked.
- Only complete days count in the maintenance estimate and weekly average. Others keep their totals in History.

## Overview

Today / Week / Month. Main figure: average kcal of complete days against target; then protein days ("Protein reached on 5 of 7 days."), macros as meters, calories by meal, top 5 foods by kcal, and when Health last synced.

## Weight

Trend and today's reading; a 1 Month / 3 Months / All chart (trend in `--ink`, readings as dots) with "Show as a Table"; "Add Weight"; the estimate and target with how they're counted.

## Weekly review

Monday morning, covering the previous Monday to Sunday.

- `GET /summary?date=` (or `POST /summary { timestamp }`) returns plain text for the week before the date's: complete-day average against target, trend change, protein days, To check count, unreviewed days. A Monday Shortcut shows it as a notification.
- A "Weekly Review" card shows on Log from Monday until done; `reviews.id` is the week's Monday.
  1. Clear To check; "Mark N Days Complete" for unflagged unreviewed days (real count); flagged days (under 60% of target) one by one: "Was Tuesday complete?"
  2. The week: average against target, protein days, trend change, top foods.
  3. Adaptive: "Use 2,050 kcal" or "Keep 2,100 kcal". Fixed: trend against goal with one suggested target.
  Then "Done"; the toast says how many weeks in a row.

## Screens

1. **Log**: headline, review card (when due), To check, Log a Saved Meal, sentence / photo / barcode logging, search, quick add.
2. **Overview**: Today / Week / Month.
3. **Foods**: My Foods / Saved Meals / Recipes.
4. **History**: by day with each day's state; search; edit and delete with Undo; Copy to Today; Mark Complete / Mark Incomplete.
5. **Weight**: trend, chart, estimate, Add Weight.
- **Settings** (header icon): goal, mode and targets, floor, exercise added back, meal times, weight units, food sources, backend, backup and restore, CSV export.

## Later

- **Dietary write-back to Apple Health** (version two): each nutrient per date claimed before writing, never retried automatically; an unconfirmed write is marked incomplete and needs "Leave Incomplete" or "Retry Anyway" (which warns of a possible duplicate). Exactly-once isn't guaranteed.

## Named rules to test

- Scaling per-100 g nutrition by grams in integer units, rounding once.
- Import per source (Open Food Facts, CoFID, SG FoodID, USDA), per 100 g and for a portion, including CoFID "Tr" / "N", SG FoodID's trace and no data, and USDA's energy order.
- kJ to kcal; source energy never recalculated. USDA carbs minus fibre, or kept and marked. Salt from sodium × 2.5.
- Unknown nutrients stay unknown through scaling, totals, recipes and display.
- Entries keep copied nutrition and assumptions when the food or recipe changes.
- Parse validation: grams above zero and at most 5,000; unknown fields dropped; no nutrition except kcal the sentence gives.
- Estimates only for unmatched items; `nutritionBasis` and `portionBasis` right, a guessed portion becoming typed when edited.
- Recipes: per gram from totals and finished weight; finished weight defaulting to the sum; portions with the remainder last; estimates and unknowns carried; grams left never below zero.
- Net MET kcal; manual workouts not added on days with Health active energy.
- `/health` replacing activity and adding workouts once, however often it runs.
- Saving the same record twice with `PUT` leaves one; mismatched URL and body ids rejected.
- Dates from the phone: an entry at 23:30 stays on its date; a summary picks its week from the timestamp's offset.
- Trend weight with gaps; maintenance estimate (complete days only, 28-day window, minimums, 150 kcal cap, the "still needed" message).
- Adaptive target from the goal rate; the floor; changing only when accepted.
- Headline: left and over, To check as estimates, exercise added back in fixed mode only.
- Meal slot from the time, never snacks.
- Names shown in title case whatever their source's case.
- Weekly summary and review bounds: previous Monday to Sunday from a timestamp in any offset; complete-day average, protein days, unreviewed count; "Mark N Days Complete" marks only unflagged unreviewed days, never today.
- The offline draft survives a refresh and a failed save.
- Restore: all or nothing; malformed JSON, missing fields, duplicate ids, broken references and a failure partway each leave the database unchanged.
- No route answers without a valid token.
- Cost guard: the 101st call refused; two calls at 99 let exactly one through; parse and estimate both count; keyed by UTC date.
