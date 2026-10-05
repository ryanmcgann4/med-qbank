import { Cloud, CloudAlert, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSyncState } from '../hooks/useSync';
import { syncNow } from '../lib/sync/controller';
import { cn } from './ui';

function ago(t: number, now: number): string {
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Header badge: tap to sync now; on error, opens the sync settings. */
export function SyncIndicator() {
  const s = useSyncState();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!s.configured) return null;

  const label = s.status === 'syncing' ? 'Syncing…' : s.status === 'error' ? 'Sync issue' : s.lastSyncedAt ? `Synced ${ago(s.lastSyncedAt, now)}` : 'Not synced yet';
  const Icon = s.status === 'syncing' ? RefreshCw : s.status === 'error' ? CloudAlert : Cloud;
  return (
    <button
      type="button"
      onClick={() => (s.status === 'error' ? navigate('/data') : void syncNow())}
      title={s.status === 'error' ? `${s.error} (tap for sync settings)` : `${label}. Tap to sync now.`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
        s.status === 'error' ? 'text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      <Icon className={cn('h-4 w-4', s.status === 'syncing' && 'animate-spin')} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
