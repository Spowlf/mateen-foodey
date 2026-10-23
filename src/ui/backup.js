// Backup (JSON, every row), restore, and CSV export. Files go through the share sheet where the
// phone has one (Save to Files, AirDrop), otherwise they download.

import { toast } from './dom.js';
import { runAction } from './format.js';
import { today, formatDay, backupData, readBackup, entriesCsv } from '../engine/index.js';
import { OfflineError } from '../errors.js';

/** Shares or downloads a file. Returns false if the share sheet was closed without saving. */
async function deliver(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // Some browsers refuse file shares they said they could do: fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/** Saves everything as JSON. Syncs first so the file is current; offline, it says the copy is from the last sync. */
export async function exportBackup(repo) {
  let fresh = true;
  try {
    await repo.sync();
  } catch (err) {
    if (!(err instanceof OfflineError)) return toast(err.message);
    fresh = false;
  }
  const data = backupData(repo.state, { now: Date.now() });
  const file = new File([JSON.stringify(data, null, 1)], `mateen-foodey-backup-${today()}.json`, { type: 'application/json' });
  if (!(await deliver(file))) return;
  toast(fresh ? 'Saved a backup.' : 'Saved a backup from the last sync. You’re offline.');
}

/** What you ate as a spreadsheet, oldest first. */
export async function exportCsv(repo) {
  const file = new File([entriesCsv(repo.state.entries)], `mateen-foodey-entries-${today()}.csv`, { type: 'text/csv' });
  if (await deliver(file)) toast('Exported what you ate.');
}

/** Replaces everything on the backend with a backup file, after a confirm naming its date and size. */
export async function importBackup(repo, file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('Nothing changed: this file isn’t a backup.');
  }
  const check = readBackup(data);
  if (!check.ok) return toast(check.message);
  const when = check.exportedAt ? ` from ${formatDay(today(new Date(check.exportedAt)))}` : '';
  const n = check.total;
  const ok = confirm(`Replace everything on your backend with the backup${when}? It has ${n.toLocaleString('en-GB')} ${n === 1 ? 'record' : 'records'}. Anything logged since is removed.`);
  if (!ok) return;
  if (await runAction(() => repo.restoreBackup(data))) toast(`Restored the backup${when}.`);
}
