# Mateen Foodey

A personal calorie, macro and exercise tracker for one person in the UK: food in grams, energy in kcal, body weight in kg or st lb. Installable web app (PWA) on GitHub Pages, with a Cloudflare Worker + D1 backend that holds all the data. `SPEC.md` is the build spec; `HANDOVER.md` is the design language and engineering approach it follows. `reference/mateen-money-CLAUDE.md` is the last project's rules, which this file is built from. The Mateen Money repo (`../Mateen Money`) may be read for patterns but never changed. Ignore `~/Downloads/CLAUDE.md`: this file is the project's rules.

## Ground rules

- Front end: plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no bundler, no CSS framework, no CDN scripts or web fonts.
- The backend (Worker + D1) is the single source of truth. The phone caches the last-synced data in IndexedDB and opens offline read-only, showing "Last synced …". There is no outbox and no merging. Saving needs a connection; the Log screen keeps one draft while offline, which no app logic or failed request ever discards.
- Three layers, one direction: `ui → db → engine`. `src/engine/` is pure (no DOM, no storage, `today`/`now` passed in) and is shared by the front end, the Worker and the scripts.
- Quantities are integers everywhere: food in grams, energy in tenths of a kcal and nutrients in milligrams per 100 g, body weight in grams. Convert from source data once, when it's cached; convert from typed text once, on save. Scale with integer maths and round once, for display.
- Unknown is not zero: a nutrient a source doesn't give is `null` through scaling, totals, recipes and display.
- Dates are `'YYYY-MM-DD'` strings; date maths in UTC; "today" from local getters on the phone. The phone decides every date: entries carry the local date at logging, Shortcuts send the phone's date or timestamp. The Worker never works out "today" itself, except for the cost guard's UTC day. Instants are ms timestamps.
- Food databases (Open Food Facts, CoFID, USDA) and the Claude API are called by the Worker, never the phone.
- Every record has a client-generated id and is saved with `PUT /<table>/:id`, so a retry never makes a duplicate. A body whose `id` differs from the URL's is rejected.
- Every route needs the bearer token. There is no unauthenticated route.
- Never commit the API token, the Anthropic or USDA keys, backups or `.dev.vars`. They are Worker secrets; the token is also typed into Settings on the phone. The Worker never logs the token or food data.
- Build in stages. Tests for the maths before any interface. Check in with the user after each stage. **Commit and push automatically.**
- Push straight to `main`, never to a feature branch (even one a session is set up with).
- When you add a front-end file, add it to `FILES` in `sw.js` (a test checks this).

## Stages

1. Engine and tests: nutrition scaling and units, recipes, MET, trend weight, maintenance estimate, targets, headline, weekly summary. Every named rule in SPEC.md has a test before any interface exists.
2. Backend: D1 schema, sync routes, food search and barcode lookup with caching (Open Food Facts, CoFID, USDA), the CoFID import script, `/parse` with Claude Haiku 5.5 and the cost guard, `/health`, `/summary`.
3. Log screen: headline, quick log, sentence and photo logging with the check sheet, search, quick add, To check, offline draft.
4. Foods: my foods, saved meals, recipes, batches and pots.
5. Overview and Weight.
6. History and Settings.
7. Weekly review.
8. Shortcuts and exercise: Health sync, sentence logging, the weight history import script, `docs/shortcuts.md`, and manual exercise (`data/activities.json` with MET values and sources).
9. PWA and deployment.

## Commands

- `npm test`: runs every test (`node --test`, no dependencies).
- `npm run dev`: the app on http://localhost:3000 and the Worker on http://localhost:8787 (Node SQLite, data in `.dev.db`, token `dev-token`). `APP_PORT`, `API_PORT` and `DEV_DB` change the defaults; it listens on 127.0.0.1 only unless `HOST` says otherwise.

## Decisions

The dated decision log is `docs/decisions.md` (many are the user's own choices). Before changing an area's behaviour or wording, grep it for that area; add new decisions there, not here. Never undo one without asking. The ones that touch almost every change:

- An estimate is never shown as a fact: estimated nutrition, guessed portions, To check entries, manual exercise and the maintenance estimate carry "~" and say what's estimated.
- Being over a target is said in plain ink, never red ("180 kcal over today."). Red keeps its HANDOVER meaning (avoid / danger), which no food choice is.
- Only days marked complete count in the maintenance estimate and the weekly average. Today is never marked.
- Entries copy their food's name, nutrition and assumptions at logging and are never recalculated.
- A refresh from a source never overwrites a food the user edited (`userEdited`).
- Any change under `worker/` or `src/engine/` needs a Worker redeploy as well as a push.

## Writing style

Applies to every string the user sees, including notification text from the Worker and Shortcuts.

- Title case for headers and controls: buttons (disabled ones too), field labels, chips, segments, select options, toggles and disclosure summaries ("Log 3 Items", "Weigh the Finished Dish", "Show as a Table"). Short joining words stay lower case unless first or last (`titleCase()` in `src/engine/text.js`). Sentence case for everything that's a message: hints, toasts, warnings, small print, tags, placeholders, table and total row labels, and screen-reader-only labels. No ALL CAPS.
- Full sentences end with a period (hints, warnings, toasts that are sentences, the headline: "~1,240 kcal left today."). Labels, buttons, chips, food names and titles don't.
- Use " / " for alternatives. No "&", no parentheses in names.
- Energy is whole kcal with thousands separators ("1,240 kcal"); macros are whole grams with a space ("58 g protein"); food amounts are whole grams ("150 g"); body weight follows the units setting ("72.4 kg" or "11 st 6 lb"). Format with a fixed locale (`en-GB`), never string building.
- Estimated figures carry a "~" and say what's estimated ("~ Portion guessed", "Fibre unknown for 2 foods.", "~2,350 kcal, from 21 complete days and your weight trend.").
- Dates as "30 Sep 2026". "Today" only for the nearest.
- Say what to do, not what went wrong: "Enter grams above zero."
- Buttons are verbs for what happens ("Log 3 Items"); disabled buttons say what's missing ("Enter the Grams").
- Errors say whether anything changed: "Nothing changed: …".
- Second person, short, one idea per sentence. Plain words ("Portion guessed", not "gramsAssumed").

## Design principles

- Our look is chosen, not defaulted. Use only the colour tokens in styles.css; don't add gradients, glows, coloured top stripes, glass/blur or new accent colours.
- Motion only explains a change of state (e.g. the headline figure updating after a log). No looping, timed, scroll-triggered or decorative animation. Respect prefers-reduced-motion.
- Nothing important is hidden behind hover, long-press or swipe. Pressed and hover states make an element more prominent, never less.
- Type: screen title, section heading, body, small print and the number style. No other text styles, and no labels that repeat nearby text.
- One look per meaning: segmented controls for switching views, pill chips for picking values, one primary and one secondary button style.
- No generic dashboard patterns: no coloured icon tiles on stat cards, no icon-plus-text grids, no emoji, no stock illustration.
- Secondary text meets 4.5:1 contrast in light and dark mode.
- Each screen shows its most useful information first, with no decorative space above it. On Log that's the headline, protein, quick log and the add field.
- Every decorative detail must have a stated reason. If it has none, remove it.
