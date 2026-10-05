import { useLiveQuery } from 'dexie-react-hooks';
import { DatabaseBackup, X } from 'lucide-react';
import { useState } from 'react';
import { db, getKV, setKV } from '../db';
import { BACKUP_SNOOZE_KEY, downloadBackup, LAST_BACKUP_KEY } from '../lib/backup';
import { daysBetween, DAY_MS } from '../lib/dates';
import { Button } from './ui';

const WEEK = 7 * DAY_MS;

/** Weekly nudge to download a backup. Dismissing snoozes it for a week. */
export function BackupBanner() {
  const [now] = useState(() => Date.now());
  const state = useLiveQuery(async () => {
    const first = await db.imports.orderBy('importedAt').first();
    return {
      first: first?.importedAt ?? null,
      last: await getKV<number | null>(LAST_BACKUP_KEY, null),
      snoozed: await getKV<number | null>(BACKUP_SNOOZE_KEY, null),
    };
  }, []);
  if (!state?.first) return null;
  const since = state.last ?? state.first;
  if (now - since < WEEK || (state.snoozed && now - state.snoozed < WEEK)) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <DatabaseBackup className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="flex-1">
          {state.last ? `Your last backup was ${daysBetween(state.last, now)} days ago.` : "You haven't backed up your question bank yet."} Your data only lives in this
          browser.
        </span>
        <Button size="sm" onClick={() => void downloadBackup()}>
          Back up now
        </Button>
        <button
          type="button"
          aria-label="Dismiss for a week"
          title="Remind me next week"
          onClick={() => void setKV(BACKUP_SNOOZE_KEY, Date.now())}
          className="rounded p-1 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
