// Imports your body weight history from the Health app, once. On the iPhone: Health, your picture,
// Export All Health Data; AirDrop the zip to the Mac and unzip it. Then:
//
//   FOODEY_API=https://… FOODEY_TOKEN=… node scripts/import-health-weights.js <export.xml>           prints what it will import
//   FOODEY_API=https://… FOODEY_TOKEN=… node scripts/import-health-weights.js <export.xml> --apply   uploads it
//
// The token comes from the environment, never the command line, so it stays out of your shell
// history. For npm run dev: FOODEY_API=http://localhost:8787 FOODEY_TOKEN=dev-token.
// One reading a day (the latest weighed that day), on the date it was weighed where you were. A day
// that already has a reading is left alone, so running it again adds nothing and never replaces a
// weight from the app or the Health Shortcut. The file is read a line at a time: exports run to gigabytes.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { healthWeightRecord, latestPerDay, formatDay, formatWeight } from '../src/engine/index.js';

const PER_WRITE = 400;   // under the Worker's 500 rows a write

/** Every body weight in the export, one a day. */
export async function readWeights(file) {
  const records = [];
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    const r = healthWeightRecord(line);
    if (r) records.push(r);
  }
  return latestPerDay(records);
}

/** The days to upload: those with no reading saved yet. */
export const toUpload = (days, savedDates) => days.filter((d) => !savedDates.has(d.date));

/** What the import will do, for a person to read before --apply. */
export function summary(days, uploads) {
  const n = (x) => x.toLocaleString('en-GB');
  if (!days.length) return 'No body weights found in this file. Check it’s export.xml from the unzipped export.';
  const lines = [`Health: ${n(days.length)} days with a weight, ${formatDay(days[0].date)} to ${formatDay(days.at(-1).date)}.`];
  const kept = days.length - uploads.length;
  if (kept) lines.push(kept === 1 ? '1 of them already has a reading, which is kept.' : `${n(kept)} of them already have a reading, which is kept.`);
  lines.push(uploads.length ? `${n(uploads.length)} to upload.` : 'Nothing to upload.');
  for (const d of uploads.slice(0, 3)) lines.push(`  ${formatDay(d.date)}: ${formatWeight(d.grams)}`);
  if (uploads.length > 3) lines.push('  …');
  return lines.join('\n');
}

async function api(base, token, method, path, body) {
  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `the backend answered ${res.status}`);
  return data;
}

async function main(args) {
  const file = args.find((a) => !a.startsWith('--'));
  const { FOODEY_API: base, FOODEY_TOKEN: token } = process.env;
  if (!file || !base || !token) {
    console.log('Usage: FOODEY_API=<backend address> FOODEY_TOKEN=<token> node scripts/import-health-weights.js <export.xml> [--apply]');
    process.exit(1);
  }
  const days = await readWeights(file);
  const sync = await api(base, token, 'GET', '/sync?since=0');
  const saved = new Set((sync.changes.weights ?? []).filter((w) => !w.deletedAt).map((w) => w.date));
  const uploads = toUpload(days, saved);
  console.log(summary(days, uploads));
  if (!uploads.length) return;
  if (!args.includes('--apply')) {
    console.log('\nNothing written. Run again with --apply to upload them.');
    return;
  }
  for (let i = 0; i < uploads.length; i += PER_WRITE) {
    const weights = uploads.slice(i, i + PER_WRITE).map((d) => ({ id: d.date, date: d.date, grams: d.grams, source: 'import', deletedAt: null }));
    await api(base, token, 'POST', '/batch', { weights });
  }
  console.log(`\nUploaded ${uploads.length.toLocaleString('en-GB')} weights.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Stopped: ${err.message}. Anything uploaded before this is kept; run it again to add the rest.`);
    process.exit(1);
  });
}
