# Shortcuts

Three Shortcuts talk to the backend, plus a script you run once on the Mac. Each Shortcut sends one request to the Worker and shows its one-line reply as a notification.

You need:

- **The backend address**: the Worker's URL, the one in Settings → Backend. Below it's written `https://YOUR-WORKER`.
- **The API token**: the same token as in Settings. Below it's written `YOUR-TOKEN`.

> **Keep these Shortcuts to yourself.** Each one holds the token, and sharing a Shortcut shares the token with it. If one ever leaks, set a new token (`npx wrangler secret put API_TOKEN`), then type it into Settings and into each Shortcut.

Every request has the same header: `Authorization` = `Bearer YOUR-TOKEN` (the word Bearer, a space, then the token). The phone always sends its own date or time. The Worker never works the date out itself.

## 1. Sync Health

Sends today's active energy, steps and weight from the Health app. It runs each morning on its own, and from **Sync Health** on Overview. That button opens the Shortcut by name, so the name must be exactly `Sync Health`. iOS always switches to the Shortcuts app to run it; tap ◀ Mateen Foodey in the top-left corner to come back.

In the Shortcuts app, make a new Shortcut called **Sync Health** with these actions:

1. **Date**: Current Date.
2. **Format Date**: Date Format *Custom*, `yyyy-MM-dd`. Rename the result *Day*.
3. **Find Health Samples** where *Type* is *Active Energy* and *Start Date* is *Today*. Then **Calculate Statistics**: *Sum*. Rename the result *Active*.
4. **Find Health Samples** where *Type* is *Steps* and *Start Date* is *Today*. Then **Calculate Statistics**: *Sum*. Rename the result *Steps*.
5. **Find Health Samples** where *Type* is *Weight* and *Start Date* is *Today*, sorted by *Start Date*, *Latest First*, limit 1. Then **Get Details of Health Sample**: *Value*. Rename the result *Weight*.
   - If Health shows your weight in stones or pounds, add **Convert Measurement** to *kilograms* after it. The Worker takes kilograms.
6. **Dictionary** with:
   - `date` (Text): *Day*
   - `activeKcal` (Number): *Active*
   - `steps` (Number): *Steps*
   - `weightKg` (Number): *Weight*
7. **Get Contents of URL**: `https://YOUR-WORKER/health`, *Method* POST, *Headers* `Authorization` = `Bearer YOUR-TOKEN`, *Request Body* JSON, set to the *Dictionary*.
8. **Show Notification**: *Contents of URL*.

Run it once by hand. The notification should read like "Synced 23 Oct: 480 active kcal, 9,120 steps, 72.4 kg." Check that the weight matches Health.

A day with no weigh-in sends an empty weight, which Shortcuts turns into 0; the Worker takes 0 as no reading, so the activity still saves. Running it again later in the day replaces that day's activity. A weight sent again replaces the day's reading.

**Workouts (optional).** Health's active energy already includes every workout, so the targets don't need them. To list them on Overview as well, add a `workouts` entry to the Dictionary: a list of dictionaries, each with `start` (the workout's start date as ISO 8601), `type` (text), `minutes` and `kcal` (numbers). The Worker adds each one once, matched by start and type, however often the Shortcut runs.

**Run it each morning.** Go to Automation → New Automation → *Alarm* → *Is Stopped* (your wake-up alarm) → *Run Immediately*, and run **Sync Health**. Turn off *Notify When Run*: the Shortcut's own notification says what it sent.

## 2. Log a Sentence

Logs what you ate from one dictated sentence, without opening the app. The entries arrive as **To check** on Log, with their portions marked as guessed where you didn't say them. Each one is confirmed with one tap.

New Shortcut, **Log Food**:

1. **Dictate Text** (or **Ask for Input**, to type instead). Rename the result *Sentence*.
2. **Date**: Current Date. Then **Format Date**: *ISO 8601*, with *Include ISO 8601 Time* on. Rename the result *Time*. It looks like `2026-10-23T12:40:05+01:00`, and its offset picks the date and the meal.
3. **Dictionary**: `text` (Text): *Sentence*; `timestamp` (Text): *Time*.
4. **Get Contents of URL**: `https://YOUR-WORKER/log`, POST, the same header, JSON body the *Dictionary*.
5. **Show Notification**: *Contents of URL*.

The reply says what it read: "3 items to check: eggs, toast, flat white." Anything it couldn't find is named: "Search for haggis in the app." Running the same request twice adds nothing ("Already saved: …"). Each run uses one of the day's 100 model calls.

Add it to the Action button, Back Tap (Settings → Accessibility → Touch → Back Tap) or Siri ("Log Food").

## 3. Weekly Summary

A notification on Monday morning about the week just ended (Monday to Sunday). It gives your average on complete days against target, protein days, the trend's change, and anything left to check or review. The review itself is the card on Log.

Automation → New Automation → *Time of Day*, 07:30, *Weekly*, Monday → *Run Immediately*, with a new Shortcut:

1. **Date**: Current Date. Then **Format Date**: *ISO 8601*, *Include ISO 8601 Time* on. Rename the result *Time*.
2. **Dictionary**: `timestamp` (Text): *Time*.
3. **Get Contents of URL**: `https://YOUR-WORKER/summary`, POST, the same header, JSON body the *Dictionary*.
4. **Show Notification**: *Contents of URL*.

The week is picked from the phone's own date and time zone, so it's right wherever you are.

## Weight history, once, on the Mac

This brings in every weigh-in Health already has, so the trend and the maintenance estimate start with your history.

1. On the iPhone: Health → your picture → **Export All Health Data**. AirDrop the zip to the Mac and unzip it. You need `apple_health_export/export.xml`.
2. In the project folder on the Mac, see what it will import:

   ```sh
   FOODEY_API=https://YOUR-WORKER FOODEY_TOKEN=YOUR-TOKEN node scripts/import-health-weights.js ~/Downloads/apple_health_export/export.xml
   ```

3. If it looks right, run the same command with `--apply` on the end.

It keeps one reading a day (the latest that day), on the date you weighed in where you were. A day that already has a reading is left alone, so running it again adds nothing. The token is read from the environment, never typed as an argument. Even so, the line above stays in your shell history, so you may prefer `export FOODEY_TOKEN=…` on its own line first, or `read -s FOODEY_TOKEN`.

## Manual exercise

There's no Shortcut for this. On Overview → Today → **Add Exercise**, pick an activity and the minutes. The kcal are (MET − 1) × your latest weight in kg × hours. The MET values come from the 2024 Adult Compendium of Physical Activities, kept in `data/activities.json` with each activity's code. That's energy above resting, the same basis as Health's active energy, and it's shown with "~". On a day when Health sent active energy, a workout added here isn't counted again, since Health already counted it.
