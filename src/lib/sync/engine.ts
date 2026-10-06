import Dexie from 'dexie';
import { db as defaultDb, type QBankDB } from '../../db';
import { mergeIntoChanged } from '../backup';
import type { BackupData } from '../merge';
import type { RepoClient, TreeChange } from './github';
import { fromShards, gitBlobSha, MANAGED, SHARD_TABLES, tableOf, toShards, type ShardTable } from './shards';

/**
 * Remote file → blob sha as of our last sync. Lives in this browser's DB (not
 * localStorage), so wiping or replacing the DB also forgets it and the next
 * sync does a full pull instead of mistaking an empty bank for deletions.
 */
const CACHE_KEY = 'syncRemoteShas';

/** Rebuild every file from scratch at least this often, as a backstop for the change tracking below. */
const FULL_REBUILD_MS = 30 * 60_000;

/**
 * This device's files as of the last time each table was read (path → blob
 * sha), so a sync only re-reads and re-hashes tables written since. Memory
 * only: every app launch starts with a full rebuild.
 */
const localFiles = new WeakMap<QBankDB, { shas: Map<string, string>; builtAt: number }>();

/** Tables written since their files were last built, by database name. Dexie reports writes from every tab. */
const dirty = new Map<string, Set<ShardTable>>();
const isShardTable = (t: string): t is ShardTable => (SHARD_TABLES as readonly string[]).includes(t);
function markDirty(dbName: string, tables: Iterable<string>) {
  let set = dirty.get(dbName);
  if (!set) dirty.set(dbName, (set = new Set()));
  for (const t of tables) if (isShardTable(t)) set.add(t);
}
Dexie.on('storagemutated', (parts) => {
  for (const key of Object.keys(parts)) {
    const m = /^idb:\/\/([^/]+)\/([^/]+)\//.exec(key);
    if (m) markDirty(m[1], [m[2]]);
  }
});

const EMPTY: BackupData = { questions: [], lectures: [], progress: [], attempts: [], sessions: [], imports: [], kv: [], deletions: [], exams: [], folders: [] };
/** Let the browser paint between tables, so a big rebuild doesn't freeze a quiz. */
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * This device's files: shas for all of them, and contents for the tables
 * rebuilt now (those changed since last time, plus `also`). Everything else
 * comes from the cache.
 */
async function localState(database: QBankDB, also: Iterable<ShardTable> = []) {
  const cached = localFiles.get(database);
  const full = !cached || Date.now() - cached.builtAt > FULL_REBUILD_MS;
  const tables = new Set<ShardTable>(full ? SHARD_TABLES : [...(dirty.get(database.name) ?? []), ...also]);
  dirty.set(database.name, new Set()); // writes from here on count toward the next round
  try {
    const contents = new Map<string, string>();
    for (const t of tables) {
      const rows = await database.table(t).toArray();
      for (const [path, content] of toShards({ ...EMPTY, [t]: rows })) if (tableOf(path) === t) contents.set(path, content);
      await yieldToUI();
    }
    const shas = new Map(full ? [] : [...cached!.shas].filter(([path]) => !tables.has(tableOf(path))));
    for (const [path, content] of contents) shas.set(path, await gitBlobSha(content));
    localFiles.set(database, { shas, builtAt: full ? Date.now() : cached!.builtAt });
    return { shas, contents, tables };
  } catch (e) {
    localFiles.delete(database); // the change tracking was just reset, so start over next time
    throw e;
  }
}

export interface SyncResult {
  /** Files downloaded and merged in. */
  pulled: number;
  /** Files uploaded (changed or new) plus files removed. */
  pushed: number;
  commit: string | null;
}

/**
 * One round: download remote files that changed since last time, merge them
 * into the local bank, then upload whatever local now has that the remote
 * doesn't, as a single commit. If another device committed in between, start
 * over (merging is idempotent, so retrying is always safe).
 */
export async function syncOnce(client: RepoClient, database: QBankDB = defaultDb, device = 'device'): Promise<SyncResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await client.getHead();
    const remote = await client.getTree(head.tree);
    const cache = ((await database.kv.get(CACHE_KEY))?.value ?? {}) as Record<string, string>;

    const changed = [...remote].filter(([path, sha]) => MANAGED.test(path) && cache[path] !== sha);
    const downloaded = new Map<string, string>();
    for (const [path, sha] of changed) downloaded.set(path, await client.getBlob(sha));
    if (downloaded.size) markDirty(database.name, (await mergeIntoChanged(fromShards(downloaded), database)).changed);

    // Local is now a superset of the remote, minus anything deleted.
    let local = await localState(database);
    // A cached file that differs from the remote (e.g. an earlier push failed) needs its content to upload: rebuild its table too.
    const stale = new Set([...local.shas].filter(([path, sha]) => remote.get(path) !== sha && !local.contents.has(path)).map(([path]) => tableOf(path)));
    if (stale.size) local = await localState(database, [...local.tables, ...stale]);

    const changes: TreeChange[] = [];
    const uploads: { path: string; content: string }[] = [];
    for (const [path, sha] of local.shas) {
      if (remote.get(path) !== sha) {
        uploads.push({ path, content: local.contents.get(path)! });
        changes.push({ path, sha });
      }
    }
    for (const path of remote.keys()) if (MANAGED.test(path) && !local.shas.has(path)) changes.push({ path, sha: null });

    const nextCache = Object.fromEntries([...remote].filter(([p]) => MANAGED.test(p)));
    if (!changes.length) {
      await database.kv.put({ key: CACHE_KEY, value: nextCache });
      return { pulled: downloaded.size, pushed: 0, commit: null };
    }

    for (const u of uploads) await client.createBlob(u.content);
    const tree = await client.createTree(head.tree, changes);
    const answers = uploads.filter((u) => u.path.startsWith('attempts/')).length;
    const commit = await client.createCommit(`Sync from ${device}${answers ? ` (answers on ${answers} day${answers === 1 ? '' : 's'})` : ''}`, tree, head.commit);
    if (!(await client.updateRef(commit))) continue; // someone else synced first; pull their changes and retry

    for (const c of changes) {
      if (c.sha) nextCache[c.path] = c.sha;
      else delete nextCache[c.path];
    }
    await database.kv.put({ key: CACHE_KEY, value: nextCache });
    return { pulled: downloaded.size, pushed: changes.length, commit };
  }
  throw new Error('Another device kept syncing at the same moment. Try again.');
}
