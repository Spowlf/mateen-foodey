# Mateen Foodey

A personal calorie, macro and exercise tracker for one person in the UK: food in grams, energy in kcal, body weight in kg or st lb. A PWA on GitHub Pages with a Cloudflare Worker + D1 backend holding all the data. `SPEC.md` is the spec, `HANDOVER.md` the design language and engineering approach. `../Mateen Money` may be read for patterns but never changed. Ignore `~/Downloads/CLAUDE.md`: this file is the project's rules.

## Ground rules

- Front end: plain HTML, CSS and JavaScript (ES modules). No framework, build step, bundler, CSS framework, CDN scripts or web fonts.
- The backend is the single source of truth. The phone caches the last sync in IndexedDB and opens offline read-only ("Last synced …"). No outbox, no merging. Saving needs a connection; Log keeps one offline draft, which no app logic or failed request discards.
- Three layers, one direction: `ui → db → engine`. `src/engine/` is pure (no DOM, no storage, `today`/`now` passed in), shared by the front end, the Worker and the scripts.
- Quantities are integers: food in grams, energy in tenths of a kcal and nutrients in mg per 100 g, body weight in grams. Convert source data once, when cached; typed text once, on save. Integer scaling, rounded once for display.
- Unknown is not zero: a missing nutrient is `null` through scaling, totals, recipes and display.
- Dates are `'YYYY-MM-DD'` strings; date maths in UTC; "today" from local getters on the phone, which decides every date. The Worker never works out "today", except the cost guard's UTC day. Instants are ms timestamps.
- Food databases and the Claude API are called by the Worker, never the phone.
- Every record has a client-generated id, saved with `PUT /<table>/:id`; a body whose `id` differs from the URL's is rejected.
- Every route needs the bearer token.
- Never commit the API token, Anthropic or USDA keys, backups or `.dev.vars`. The Worker never logs the token or food data.
- All nine build stages are done. Test the maths before the interface. **Commit and push automatically**, straight to `main`, never a feature branch.
- When you add a front-end file, add it to `FILES` in `sw.js` (a test checks this).
- Check UI changes with a screenshot at phone width (`npm run dev`, then headless Chrome from `~/.cache/puppeteer/`). iOS Safari differs: it lacks `field-sizing`, and gives date and time fields their own width.

## Commands

- `npm test`: every test (`node --test`, no dependencies).
- `npx wrangler deploy`: deploys the Worker, needed after any change under `worker/` or `src/engine/`. The app deploys by pushing to `main`; if the GitHub Pages run fails or sticks, re-run or push again.
- API token: `security find-generic-password -s mateen-foodey-api-token -w | pbcopy`.
- `npm run dev`: app on http://localhost:3000, Worker on http://localhost:8787 (Node SQLite in `.dev.db`, token `dev-token`). `APP_PORT`, `API_PORT`, `DEV_DB`, `HOST` change the defaults.

## Decisions

`docs/decisions.md` is the dated log (many are the user's own choices). Grep it before changing an area's behaviour or wording; add new decisions there, not here. Never undo one without asking. The ones that touch most changes:

- An estimate is never shown as a fact: estimated nutrition, guessed portions, To check entries, manual exercise and the maintenance estimate carry "~" and say what's estimated.
- Over a target is said in plain ink, never red ("180 kcal over today.").
- Only days marked complete count in the maintenance estimate and weekly average. Today is never marked.
- Entries copy their food's name, nutrition and assumptions at logging and are never recalculated.
- A source refresh never overwrites a food the user edited (`userEdited`).

## Writing style

Every string the user sees, including Worker and Shortcut notifications.

- Title case for headers and controls: buttons (disabled too), field labels, chips, segments, select options, toggles, disclosure summaries and empty-state headings ("Log 3 Items", "Nothing Logged Yet"). Short joining words stay lower case unless first or last (`titleCase()` in `src/engine/text.js`). Sentence case for messages: hints, toasts, warnings, small print, tags, placeholders, table and total row labels, screen-reader-only labels. No ALL CAPS.
- Food, saved meal, recipe and activity names always show through `nameCase()` (title case whatever the source's case; short acronyms and units kept).
- Units stay lower case, even in labels ("Daily kcal", "kg").
- Full sentences end with a period ("~1,240 kcal left today."). Labels, buttons, chips, names and titles don't.
- " / " for alternatives. No "&", no parentheses in names.
- Whole kcal with separators ("1,240 kcal"); whole grams with a space ("58 g protein", "150 g"); body weight per the units setting ("72.4 kg", "11 st 6 lb"). Format with `en-GB`, never string building.
- Estimates carry "~" and say what's estimated ("~ Portion guessed", "Fibre unknown for 2 foods.").
- Dates as "30 Sep 2026". "Today" only for the nearest.
- Say what to do, not what went wrong ("Enter grams above zero."). Buttons are verbs ("Log 3 Items"); disabled ones say what's missing ("Enter the Grams"). Errors say whether anything changed ("Nothing changed: …").
- Second person, short, one idea per sentence, plain words.

## Design principles

- Use only the colour tokens in styles.css: no gradients, glows, coloured top stripes, glass/blur or new accents.
- Motion only explains a change of state. No looping, timed, scroll-triggered or decorative animation. Respect prefers-reduced-motion.
- Nothing important behind hover, long-press or swipe. Pressed and hover states make an element more prominent, never less.
- Type: screen title, section heading, body, small print, number style. Nothing else, and no labels repeating nearby text.
- One look per meaning: segmented controls switch views, pill chips pick values, one primary and one secondary button style.
- No generic dashboard patterns: no coloured icon tiles, icon-plus-text grids, emoji or stock illustration.
- Secondary text meets 4.5:1 contrast in light and dark mode.
- Screens and sheets scroll up and down only, without bounce; text fits its box at phone width.
- Each screen shows its most useful information first. On Log: the headline, protein, Log a Saved Meal and the add field.
- Every decorative detail needs a stated reason, or it goes.
