# Spec

A personal calorie, macro and exercise tracker for one person in the UK. Food in grams, energy in kcal, body weight in kg (shown as kg or st lb). Design, architecture, writing style and testing follow `HANDOVER.md` and Mateen Money's conventions (`reference/mateen-money-CLAUDE.md`), with the data on a small backend.

## Moment of use

Right after eating, or while plating up, phone in one hand. A regular food or meal takes two taps; anything new takes one typed or dictated sentence and a check of the portions. Dictation is the iOS keyboard's own; the app builds no microphone feature.

## Backend (single source of truth)

- Cloudflare Workers + D1. Every route requires the bearer token (a Worker secret, typed into Settings); the token is the access control. CORS additionally limits browsers to the GitHub Pages origin. The Worker validates every request body and never logs the token or food data.
- Worker secrets: `API_TOKEN`, `ANTHROPIC_API_KEY`, `USDA_API_KEY`. Never in the repo.
- Food databases and the Claude API are called by the Worker, never the phone.
- Food sources: Open Food Facts (barcodes and branded UK foods; requests send an identifying User-Agent), CoFID (imported once into D1 by `scripts/import-cofid.js` from the government spreadsheet; the script prints what it will import and needs `--apply`), USDA FoodData Central (free API key). Looked-up foods are cached in D1 with `fetchedAt`.
- **Idempotent saves**: every record has a client-generated id and is saved with `PUT /<table>/:id`, so retrying after an uncertain failure (network drop after Save, phone asleep mid-request) can never create a duplicate. The Worker rejects a body whose `id` differs from the URL's.
- **Dates**: the phone decides the date. Entries carry the local date at logging; Shortcuts send the phone's date; summary requests send the phone's timestamp with its offset. The Worker never works out "today" for itself, except for the cost guard, which is a spending cap rather than user data (see Logging). Dates are `'YYYY-MM-DD'` strings, so daylight saving and travel never move an entry.
- **Offline**: the app shell is cached by the service worker; the last-synced data is cached in IndexedDB, and the app opens offline read-only with "Last synced [time]" while that cache survives. Saving needs a connection. Offline, the Log screen keeps one draft, labelled "Not synced", which survives refreshes, navigation and failed saves; no app logic or failed request ever discards it. Safari clearing site data is a separate case, covered by backup and restore.
- **Backup**: JSON export, and restore from a JSON backup (all or nothing, with a confirm naming the backup's date and record count). CSV export.
- **Restore validation**: the Worker validates the whole backup file before writing anything: valid JSON, required fields, duplicate ids, and references between foods, recipes, batches, pots and entries. It then writes it in one D1 batch, so it runs as one transaction. A rejected or failed restore leaves the database exactly as it was and says "Nothing changed: …".

## Numbers and units

- Food amounts are integer grams. Liquids can be entered in ml; a food's `mlToGrams` defaults to 1.
- Nutrition is stored per 100 g as integers: energy in tenths of a kcal; protein, carbs, fat, fibre, sugars and salt in milligrams. Converted from the source once, when cached. Scale with integer maths and round once, for display.
- **Unknown is not zero**: a nutrient the source doesn't give is stored as `null`. Totals that include an unknown say so ("Fibre unknown for 2 foods."); they never treat it as zero.
- **Energy**: the source's own kcal value is used, never recalculated from macros. Energy given only in kJ: kcal = kJ ÷ 4.184.
- **Carbs** follow UK / EU labels, fibre excluded. USDA carbs (by difference) become carbs − fibre when fibre is known; when it isn't, carbs are kept as given, fibre is `null`, and the food is marked `carbsIncludeFibre` and shown as "Carbs may include fibre."
- **Salt**: when a source gives only sodium, salt = sodium × 2.5.
- Display: kcal whole with thousands separators ("1,240 kcal"); macros in whole grams ("58 g protein"). Estimates carry "~" and say what's estimated.
- Body weight in integer grams.

## Data

- **Foods** `{ id, name, brand, barcode, state, per100g, carbsIncludeFibre, servings, mlToGrams, source, sourceId, fetchedAt, assumptions, usualGrams, useCount, lastUsedAt, userEdited }`. `state`: `raw`, `cooked` or `asSold`. `servings`: `[{ label, grams }]` ("1 slice", 36). `source`: `off`, `cofid`, `usda`, `custom` or `estimate`. `assumptions`: for estimates, the text the estimate rests on. A refresh from a source never overwrites a food the user edited.
- **Entries** `{ id, date, meal, foodId, batchId, name, grams, nutrition, nutritionBasis, portionBasis, assumptions, status, origin, createdAt }`.
  - Name, nutrition and assumptions are copied at logging and never recalculated, so editing a food or recipe never changes past days.
  - `nutritionBasis`: `database` (a source or the user's own food), `estimate` or `quick` (typed kcal).
  - `portionBasis`: `weighed` or `typed` (grams entered by the user), `serving` (a labelled serving), or `guessed` (grams the parser assumed and the user didn't change).
  - `meal`: breakfast, lunch, dinner or snacks. `status`: `logged` or `toCheck`. `origin`: manual, sentence, photo, shortcut or quick.
- **Saved meals** `{ id, name, items: [{ foodId, grams } or { recipeId, grams }] }`. A recipe item is grams served from the recipe's latest batch when the meal is logged.
- **Recipes**, **batches** and **pots**: see Recipes.
- **Days** `{ date, state }`, `state`: `unreviewed`, `complete` or `incomplete`. See Honest gaps.
- **Weights** `{ id, date, grams, source }`, one per date; the latest wins.
- **Activity** `{ date, activeKcal, steps, source }`, one per date. **Workouts** `{ id, date, start, type, minutes, kcal, source }`.
- **Settings** as key/value rows.

## Logging

- **Headline** at the top of Log: "~1,240 kcal left today." or "180 kcal over today." in plain ink, never red. Under it: "92 g protein to go." or "Protein target reached." The headline, protein, Log a Saved Meal and the add field come before anything else on the screen.
- **Saved meals**: "Log a Saved Meal" opens the list of saved meals; a tap logs one to the chosen meal slot, with Undo. A saved meal's foods can be chosen from My Foods or Recipes as well as searched or typed. A recipe offers a third, a quarter or a fifth of its latest batch, or typed grams.
- **Sentence logging** ("two eggs, toast with butter, flat white") runs in five steps:
  1. **Parse**: `POST /parse` sends the text to Claude Haiku 5.5 (`claude-haiku-5-5`) with the 30 most-logged foods, so "my usual porridge" resolves. A JSON schema returns `[{ name, quantity, unit, grams, gramsAssumed, state, searchTerm }]`; `gramsAssumed` is true when the sentence gave no amount. No nutrition comes from this step, except kcal the sentence itself gives for an item ("Popeyes 2 piece 780 kcal"): it's kept only when that figure is in the text as calories, the item is never estimated, and it's logged like a quick add on its own name (no "~", macros unknown).
  2. **Match**: each item against the user's foods, then the cache, then Open Food Facts, CoFID and USDA.
  3. **Estimate**: only for items with no suitable match, a second call returns per-100 g nutrition and the assumptions behind it ("Assumed oats made with 200 ml semi-skimmed milk and 1 tsp honey."). Saved as an `estimate` food.
  4. **Review**: the check sheet shows each item with its match (tap to swap, or Estimate Instead when nothing listed is what you ate: `POST /estimate`, one model call), grams on a number pad, kcal and macros, Remove, and what's uncertain: "~ Estimated nutrition", "~ Portion guessed", or both, with any assumptions underneath. Editing the grams makes the portion `typed`. The button reads "Log 3 Items".
  5. **Record**: entries are saved with copied nutrition, `nutritionBasis`, `portionBasis` and assumptions.
- **Photo**: the same five steps from a photo, resized on the phone to 1,024 px on the long edge before upload. Portions from photos are always `guessed` until edited.
- **Search**: one field; your foods first, then the sources. The phone searches after a pause in typing, not on every keystroke, and the Worker caches recent queries as well as the foods they found, to keep requests to Open Food Facts and USDA modest.
- **Barcode**: typed or scanned with the camera, looked up on Open Food Facts. Scanning reads EAN-13, EAN-8, UPC-A and UPC-E with the phone's own BarcodeDetector where there is one, else ZXing, vendored into `vendor/` and served from our own origin.
- **Quick add**: kcal, with optional macros and name.
- **Meal slot**: defaults from the time of day (times editable in Settings) and can be changed on every entry.
- **Food memory**: each log updates the food's usual grams.
- **Copy**: a meal or a whole day to today.
- **To check**: entries left unconfirmed. They count in today's totals as estimates ("~"), sit at the top of Log with their count on the tab, and each takes one tap to confirm or open.
- **Cost guard**: every model call counts, parse and estimate alike. The Worker refuses the call after 100 in a day: "Nothing changed: today's limit for sentence logging is used up. Search instead." The day is the Worker's own UTC date, not the phone's, because this is a spending cap rather than user data. The check and the count are one atomic D1 statement, so two calls at once can't both take the last one. A spending limit is also set in the Anthropic Console.

## Recipes

- **Recipe** `{ id, name, ingredients: [{ foodId, grams }] }`. Ingredients are added by sentence (the same five steps) or search. Each line shows raw, cooked or as sold, because the food must match the state it was weighed in.
- **Batch**, one per time it's made: `{ id, recipeId, date, ingredients, totals, finishedGrams, potId, portions }`. "Make Again" copies the last batch's ingredients for editing.
- The finished weight defaults to the sum of the ingredients. "Weigh the Finished Dish" replaces it, weighed without the pot (zero the scales with it on).
- Logging from a batch asks for grams served (nutrition per gram = totals ÷ finished weight) or, when portions are set, a number of portions (totals ÷ portions, any rounding remainder in the last portion).
- A batch's totals carry its ingredients' unknowns and estimates: an estimated ingredient makes the batch "~".
- "~1,050 g left" is the finished weight less what's been logged, never below zero.
- The recipe shows its total kcal and macros, and one serving of 3, 4 or 5: grams each, kcal and macros. From the last batch's finished weight, or before it's made, the ingredients' sum.

## Exercise and Health

- **Health Shortcut**: `POST /health { date, activeKcal, steps, weightKg, workouts }` replaces that date's activity, adds each workout once (matched by start and type) and saves the weight. It runs from a personal automation (after dismissing the morning alarm), or by hand from the Shortcuts app. Setup is in `docs/shortcuts.md`. A weight you typed in the app is never replaced by Health's. `GET /health/weights?from=&to=` (the phone's dates, at most 31 days) lists the weights you typed, as `{ weights: [{ date, kg }] }`; Sync Health writes each to Health on a day Health has no weight.
- **Manual exercise**: an activity from `data/activities.json` (MET values from the Compendium of Physical Activities, with sources) and minutes. kcal = (MET − 1) × body kg × hours, using the latest weight, marked "~". This is net energy, above resting, the same basis as Apple Health's active energy.
- On a day with Health active energy, manual workouts don't add to it, because Health already counts them.
- **Weight history**: `scripts/import-health-weights.js`, run on the Mac, reads the Health app's export and uploads body weight records once.

## Targets and weight

- **Goal**: lose 0.25, 0.5 or 0.75 kg a week; maintain; or gain 0.25 kg a week. No faster rate is offered.
- **Mode**: fixed or adaptive.
  - Fixed: a typed daily target. Exercise is added back at the percentage set in Settings.
  - Adaptive: target = maintenance estimate ± rate × 7,700 ÷ 7. Exercise is not added back, because the estimate already includes it. The target changes only when accepted in the weekly review.
- A target never goes below the floor in Settings (default 1,500 kcal).
- A protein target in grams; carbs and fat targets optional.
- **Trend weight**: an exponential moving average, α = 0.1 a day, carried forward across missing days. The trend shows first and the day's reading second.
- **Maintenance estimate** = average intake on complete days in the last 28 days − 7,700 × trend change over the window (kg) ÷ days in the window. It uses only days marked complete, needs at least 14 of them and 8 weigh-ins. Until then it says what's still needed, built from the real state, showing each part only while it's needed: "Log 6 more complete days and add 2 more weigh-ins.", "Log 6 more complete days.", "Add 2 more weigh-ins." When both minimums are met, the estimate shows instead. It moves at most 150 kcal a week and is shown with how it's counted: "~2,350 kcal, from 21 complete days and your weight trend."

## Honest gaps

- Each past day is unreviewed until marked complete or incomplete. Today is never marked.
- The weekly review confirms the reviewed week's unflagged unreviewed days with one button, "Mark N Days Complete", showing the real count. Flagged days (under 60% of their target) are asked about separately: "Was Tuesday complete?" Days can also be marked from History.
- Only complete days count in the maintenance estimate and the weekly average ("Average of 6 complete days"). Unreviewed and incomplete days keep their totals in History.

## Overview

Today / Week / Month. The week view's main figure is the average kcal of complete days against target, followed by protein days ("Protein reached on 5 of 7 days."), macros as meters, calories by meal and the top 5 foods by kcal. When Health last synced.

## Weight

The trend weight and today's reading; a 1 Month / 3 Months / All chart (trend line in `--ink`, readings as dots) with "Show as a Table"; "Add Weight"; the maintenance estimate and target with how they're counted.

## Weekly review

The review happens on Monday morning and covers the previous Monday to Sunday.

- `GET /summary?date=` (or `POST /summary` with `{ timestamp }`) returns plain text about the week before the one the date falls in: the average kcal on complete days against target, the trend change, protein days, the To check count and the number of unreviewed days. A scheduled Monday morning Shortcut shows it as a notification.
- In the app, a "Weekly Review" card appears on Log from Monday until completed. `reviews.id` is the Monday that starts the reviewed week.
  1. Clear To check, and mark the reviewed week's days: unflagged unreviewed days with one button, "Mark N Days Complete", showing the real count; flagged days (under 60% of their target) one by one: "Was Tuesday complete?"
  2. See the week: average against target, protein days, trend change, top foods.
  3. Adaptive: the new estimate and target, with "Use 2,050 kcal" or "Keep 2,100 kcal". Fixed: the trend change against the goal rate ("Your trend fell 0.1 kg against a goal of 0.5 kg.") with one suggested target.
  Then "Done"; the toast says how many weeks in a row.

## Screens

1. **Log**: headline, weekly review card (when due), To check, Log a Saved Meal, sentence and photo logging, search, barcode, quick add.
2. **Overview**: Today / Week / Month, when Health last synced.
3. **Foods**: My Foods / Saved Meals / Recipes.
4. **History**: grouped by day, with each day's state; search; edit and delete with Undo; Copy to Today; Mark Complete / Mark Incomplete.
5. **Weight**: trend, chart, estimate, Add Weight.
- **Settings** (header icon): goal, mode and targets, floor, exercise added back, meal times, weight units, food sources, backend token, backup and restore, CSV export.

## Open questions (settle before Stage 1)

- The default percentage of exercise added back in fixed mode.
- Accent colour: Mateen Money's blue, or a different accent so the two apps can be told apart at a glance.
- Weight shown in kg or st lb.
- The app's name.

## Later

- **Dietary write-back to Apple Health** (version two). Each nutrient per date is claimed before writing to Apple Health. Claimed nutrients are never automatically retried. If a write remains unconfirmed, it is marked incomplete and needs an explicit decision to retry: "Leave Incomplete" keeps the claim; "Retry Anyway" warns that a duplicate may be created if the earlier write succeeded but its confirmation failed, and resets the claims only after confirming. Exactly-once delivery is not guaranteed.

## Named rules to test

- Scaling per-100 g nutrition by grams in integer units, rounding once.
- Import per source, per 100 g and for a logged portion: a UK packaged food (Open Food Facts), a CoFID food and a USDA food.
- kJ to kcal; the source's energy used, never recalculated from macros.
- USDA carbs: fibre subtracted when known; kept and marked when fibre is missing.
- Salt from sodium × 2.5.
- Missing nutrients stay unknown through scaling, totals, recipes and display; never zero.
- Entries keep their copied nutrition and assumptions when the food or recipe changes.
- Parse validation: grams above zero and at most 5,000; unknown fields dropped; no nutrition accepted from the parse step, except kcal the sentence gives as calories.
- Estimates only for unmatched items; `nutritionBasis` and `portionBasis` set correctly, including a guessed portion becoming typed when edited.
- Recipes: nutrition per gram from totals and finished weight; finished weight defaulting to the sum; pot subtracted; portions with the remainder in the last; estimates and unknowns carried into the batch; grams left never below zero.
- Net MET kcal, (MET − 1) × kg × hours; manual workouts not added on days with Health active energy.
- `/health` replacing a day's activity and adding workouts once, however often it runs.
- Saving the same record twice with `PUT` leaves one record.
- Dates taken from the phone: an entry logged at 23:30 stays on that date; a summary request picks its week from the timestamp's own offset.
- Trend weight, including gaps carried forward.
- Maintenance estimate: complete days only (unreviewed and incomplete left out), the 28-day window, the minimums, the 150 kcal weekly cap.
- Adaptive target from the goal rate; the floor; the target changing only when accepted.
- Headline: left and over, To check counted as estimates, exercise added back in fixed mode only.
- Meal slot from the time.
- Weekly summary figures: the previous Monday to Sunday, the complete-day average, protein days, unreviewed count.
- The offline draft survives a refresh and a failed save, and is never discarded by app logic.
- Restore replaces everything or nothing.
- No route answers without a valid token.
- PUT with mismatched URL and body ids is rejected and changes nothing.
- Restore: malformed JSON, missing fields, duplicate ids, broken references and a failure partway through each leave the database unchanged.
- Cost guard: the 101st model call in a day is refused; two simultaneous calls at a count of 99 let exactly one through; parse and estimate both count; the count is keyed by the Worker's UTC date.
- Weekly review and summary bounds: the previous Monday to Sunday, from a Monday timestamp in any offset.
- The maintenance message counts days and weigh-ins correctly, showing each part only when needed.
- "Mark N Days Complete" marks only unflagged unreviewed days in the reviewed week, and never today.
