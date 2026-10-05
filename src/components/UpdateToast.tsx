import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui';

/** Shows when a new version is deployed; reloading is your call, never automatic. */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;
  const close = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div role="status" className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-xl sm:bottom-6 dark:border-slate-700 dark:bg-slate-900">
      <span className="flex-1">{needRefresh ? 'A new version of Q-Bank is available.' : 'Q-Bank is ready to work offline.'}</span>
      {needRefresh && (
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          <RefreshCw className="h-4 w-4" /> Reload
        </Button>
      )}
      <button type="button" aria-label="Dismiss" onClick={close} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
