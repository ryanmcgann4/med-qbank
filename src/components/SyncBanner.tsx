import { CloudAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSyncState } from '../hooks/useSync';
import { DAY_MS } from '../lib/dates';

/** Being offline for a while is normal; say something only after this long without a sync. */
const QUIET_MS = 3 * DAY_MS;

/**
 * Sync that has stopped working is easy to miss (the header icon is small, and
 * GitHub tokens expire), and until it's fixed this device's answers aren't
 * backed up or reaching your other devices. So say it plainly.
 */
export function SyncBanner() {
  const s = useSyncState();
  const [now] = useState(() => Date.now());
  if (!s.configured || s.status !== 'error') return null;
  const needsYou = s.errorKind === 'auth' || s.errorKind === 'not_found' || s.errorKind === 'empty';
  const stale = !s.lastSyncedAt || now - s.lastSyncedAt > QUIET_MS;
  if (!needsYou && !stale) return null;
  const days = s.lastSyncedAt ? Math.floor((now - s.lastSyncedAt) / DAY_MS) : null;

  return (
    <div role="alert" className="border-b border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <CloudAlert className="h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400" />
        <span className="flex-1">
          <b>Sync isn&apos;t working{days ? ` (last synced ${days} day${days === 1 ? '' : 's'} ago)` : ''}.</b> {s.error} Your answers are saved on this device but
          aren&apos;t reaching your other devices.
        </span>
        <Link to="/data" className="rounded-md bg-rose-600 px-3 py-1 font-medium text-white hover:bg-rose-500">
          Fix in Settings
        </Link>
      </div>
    </div>
  );
}
