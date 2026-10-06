/**
 * The connector's view of the bank: the same sync repo the app uses, read in
 * one request (a tarball of the latest commit) and written as one commit per
 * change, in exactly the app's file format. Devices pick changes up on their
 * next sync like any other device's.
 */
import type { Attempt } from '../../src/db';
import { mergeData, type BackupData } from '../../src/lib/merge';
import { GitHubClient, type TreeChange } from '../../src/lib/sync/github';
import { fromShards, gitBlobSha, MANAGED, stableStringify, toShards } from '../../src/lib/sync/shards';
import { readTarball } from './tar';

export interface Env {
  OAUTH_KV: KVNamespace;
  /** Fine-grained token: Contents read & write on the sync repo only. */
  GITHUB_TOKEN: string;
  /** owner/name of the sync repo. */
  REPO: string;
  BRANCH?: string;
  /** What you type on the sign-in page when connecting Claude. */
  PASSPHRASE: string;
  /** For naming the day files answers go in, matching your devices. */
  TIMEZONE?: string;
}

const UA = 'qbank-connector';

interface Snapshot {
  commit: string;
  tree: string;
  /** path → blob sha for managed files. */
  shas: Map<string, string>;
  files: Map<string, string>;
  data: BackupData;
}

// Reused while this Worker instance is warm and the branch hasn't moved.
let cached: Snapshot | null = null;

const client = (env: Env) => new GitHubClient({ repo: env.REPO, branch: env.BRANCH || 'main', token: env.GITHUB_TOKEN }, { userAgent: UA });

export async function snapshot(env: Env): Promise<Snapshot> {
  const gh = client(env);
  const head = await gh.getHead();
  if (cached?.commit === head.commit) return cached;
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/tarball/${head.commit}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': UA },
  });
  if (!res.ok || !res.body) throw new Error(`Couldn't read ${env.REPO} (GitHub ${res.status}).`);
  const files = new Map([...(await readTarball(res.body))].filter(([p]) => MANAGED.test(p)));
  const shas = new Map<string, string>();
  for (const [p, c] of files) shas.set(p, await gitBlobSha(c));
  cached = { commit: head.commit, tree: head.tree, shas, files, data: fromShards(files) };
  return cached;
}

/** Answers, progress and scheduling rebuilt from the answer history, as the app does. */
export function withProgress(data: BackupData): BackupData {
  return mergeData(data, { questions: [], lectures: [], progress: [], attempts: [], sessions: [], imports: [], kv: [] });
}

/** YYYY-MM-DD in your time zone, so answers land in the same day files your devices use. */
export function dayIn(ts: number, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface Change {
  /** The bank after the change (everything except answers). */
  data: BackupData;
  /** New answers to record. */
  attempts?: Omit<Attempt, 'id'>[];
  message: string;
}

/**
 * Apply `change` to the latest bank and commit it. Only files whose content
 * changed are uploaded; nothing is ever deleted here. If a device synced in
 * the meantime, start over from its commit.
 */
export async function commitChange(env: Env, change: (data: BackupData) => Change | null): Promise<string | null> {
  const gh = client(env);
  for (let attempt = 0; attempt < 4; attempt++) {
    const snap = await snapshot(env);
    const result = change(structuredClone(snap.data));
    if (!result) return null;

    const next = new Map<string, string>();
    // Answer files are grouped by day in your time zone; add to them rather than regrouping.
    for (const [p, c] of toShards(result.data)) if (!p.startsWith('attempts/')) next.set(p, c);
    const tz = env.TIMEZONE || 'America/Chicago';
    const byDay = new Map<string, Omit<Attempt, 'id'>[]>();
    for (const a of result.attempts ?? []) byDay.set(dayIn(a.ts, tz), [...(byDay.get(dayIn(a.ts, tz)) ?? []), a]);
    for (const [day, list] of byDay) {
      const path = `attempts/${day}.json`;
      const existing = snap.files.has(path) ? (JSON.parse(snap.files.get(path)!) as Omit<Attempt, 'id'>[]) : [];
      const all = [...existing, ...list].sort((a, b) => (`${a.ts}|${a.qid}` < `${b.ts}|${b.qid}` ? -1 : 1));
      next.set(path, stableStringify(all));
    }

    const changes: TreeChange[] = [];
    for (const [path, content] of next) {
      const sha = await gitBlobSha(content);
      if (snap.shas.get(path) !== sha) {
        await gh.createBlob(content);
        changes.push({ path, sha });
      }
    }
    if (!changes.length) return null;
    const tree = await gh.createTree(snap.tree, changes);
    const commit = await gh.createCommit(result.message, tree, snap.commit);
    if (await gh.updateRef(commit)) {
      cached = null;
      return commit;
    }
    cached = null; // lost a race with a device; reload and retry
  }
  throw new Error('Your devices kept syncing at the same moment. Try again.');
}
