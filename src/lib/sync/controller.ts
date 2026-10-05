import Dexie from 'dexie';
import { db } from '../../db';
import { syncOnce } from './engine';
import { GitHubClient, SyncError, type SyncConfig } from './github';

const CONFIG_KEY = 'qbank-sync';
const LAST_KEY = 'qbank-sync-last';
/** Wait this long after the last answer before syncing, so a burst of answers is one sync. */
const DEBOUNCE_MS = 15_000;
/** While the app is open, also check for the other device's changes this often. */
const POLL_MS = 5 * 60_000;

export interface SyncState {
  configured: boolean;
  repo: string | null;
  status: 'off' | 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  error: string | null;
}

// --- config (this device only; never in backups or the synced data) ---

export function loadConfig(): SyncConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    return c?.repo && c?.token ? { branch: 'main', ...c } : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: SyncConfig | null) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage blocked */
  }
}

function readLast(): number | null {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null;
  } catch {
    return null;
  }
}

// --- observable state ---

let state: SyncState = (() => {
  const cfg = loadConfig();
  return { configured: !!cfg, repo: cfg?.repo ?? null, status: cfg ? 'idle' : 'off', lastSyncedAt: readLast(), error: null };
})();
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const getSyncState = () => state;
export const subscribeSync = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// --- running a sync ---

let running: Promise<void> | null = null;
let again = false;

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'browser';
}

/** Sync now (or right after the sync already in progress). */
export function syncNow(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  set({ status: 'syncing' });
  running = (async () => {
    try {
      await syncOnce(new GitHubClient(cfg), db, deviceName());
      const now = Date.now();
      try {
        localStorage.setItem(LAST_KEY, String(now));
      } catch {
        /* ignore */
      }
      set({ status: 'idle', lastSyncedAt: now, error: null });
    } catch (e) {
      set({ status: 'error', error: e instanceof SyncError || e instanceof Error ? e.message : String(e) });
    } finally {
      running = null;
      if (again) {
        again = false;
        void syncNow();
      }
    }
  })();
  return running;
}

/** Check access, then save and run the first sync. Throws a readable error. */
export async function connect(cfg: SyncConfig): Promise<void> {
  const repo = cfg.repo
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Enter the repository as owner/name, e.g. ryan/qbank-data.');
  const client = new GitHubClient({ ...cfg, repo });
  const info = await client.checkRepo();
  if (!info.private) throw new Error(`${repo} is public, so anyone could read your notes and answers. Use a private repository.`);
  const full = { repo, token: cfg.token.trim(), branch: cfg.branch || info.defaultBranch };
  saveConfig(full);
  set({ configured: true, repo, status: 'idle', error: null });
  await syncNow();
}

export function disconnect() {
  saveConfig(null);
  set({ configured: false, repo: null, status: 'off', error: null });
}

// --- setup codes: move the config to another device without retyping ---

const CODE_PREFIX = 'qbank-sync-1:';

export function setupCode(): string | null {
  const cfg = loadConfig();
  return cfg ? CODE_PREFIX + btoa(JSON.stringify(cfg)) : null;
}

export function parseSetupCode(code: string): SyncConfig {
  const t = code.trim();
  if (!t.startsWith(CODE_PREFIX)) throw new Error("That doesn't look like a Q-Bank setup code.");
  try {
    const cfg = JSON.parse(atob(t.slice(CODE_PREFIX.length)));
    if (cfg.repo && cfg.token) return { branch: 'main', ...cfg };
  } catch {
    /* fall through */
  }
  throw new Error('That setup code is incomplete. Copy it again from your other device.');
}

// --- automatic triggers ---

let started = false;

/** Sync on open, when returning to the app, when going to the background, after answering, and every few minutes. */
export function startAutoSync() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      dirty = false;
      void syncNow();
    }, DEBOUNCE_MS);
  };

  Dexie.on('storagemutated', (parts) => {
    if (!loadConfig()) return;
    // Quiz timers and sync bookkeeping (sessions, kv) change constantly; only real data counts.
    if (Object.keys(parts).some((k) => /\/(attempts|progress|questions|lectures|deletions|imports|exams)\//.test(k))) {
      dirty = true;
      soon();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Leaving the app (or locking the phone): push answers now rather than in 15 s.
      if (dirty) {
        if (timer) clearTimeout(timer);
        timer = null;
        dirty = false;
        void syncNow();
      }
    } else if (!state.lastSyncedAt || Date.now() - state.lastSyncedAt > 30_000) {
      void syncNow();
    }
  });
  window.addEventListener('online', () => void syncNow());
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, POLL_MS);

  void syncNow();
}
