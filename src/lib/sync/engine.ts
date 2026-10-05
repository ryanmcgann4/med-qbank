import { db as defaultDb, type QBankDB } from '../../db';
import { mergeInto, readAll } from '../backup';
import type { RepoClient, TreeChange } from './github';
import { fromShards, gitBlobSha, MANAGED, toShards } from './shards';

/**
 * Remote file → blob sha as of our last sync. Lives in this browser's DB (not
 * localStorage), so wiping or replacing the DB also forgets it and the next
 * sync does a full pull instead of mistaking an empty bank for deletions.
 */
const CACHE_KEY = 'syncRemoteShas';

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
    if (downloaded.size) await mergeInto(fromShards(downloaded), database);

    // Local is now a superset of the remote, minus anything deleted.
    const local = toShards(await readAll(database));
    const changes: TreeChange[] = [];
    const uploads: { path: string; content: string }[] = [];
    for (const [path, content] of local) {
      const sha = await gitBlobSha(content);
      if (remote.get(path) !== sha) {
        uploads.push({ path, content });
        changes.push({ path, sha });
      }
    }
    for (const path of remote.keys()) if (MANAGED.test(path) && !local.has(path)) changes.push({ path, sha: null });

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
