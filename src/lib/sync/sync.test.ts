import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QBankDB } from '../../db';
import { sampleText } from '../../test/fixtures';
import { readAll } from '../backup';
import { applyImport, deleteLectures, planImport } from '../importer';
import { recordAttempts, updateProgress } from '../tracking';
import { syncOnce } from './engine';
import type { Head, RepoClient, TreeChange } from './github';
import { fromShards, gitBlobSha, stableStringify, toShards } from './shards';

/** In-memory stand-in for a GitHub repo: blobs, trees, commits, one branch. */
class FakeRepo implements RepoClient {
  blobs = new Map<string, string>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, { tree: string; parent: string | null }>();
  head: string;
  commitCount = 0;
  /** Simulate another device winning the race this many times. */
  rejectNextUpdates = 0;
  private n = 0;

  constructor() {
    this.trees.set('t0', new Map([['README.md', 'readme-sha']]));
    this.commits.set('c0', { tree: 't0', parent: null });
    this.head = 'c0';
  }
  async getHead(): Promise<Head> {
    return { commit: this.head, tree: this.commits.get(this.head)!.tree };
  }
  async getTree(tree: string) {
    return new Map(this.trees.get(tree)!);
  }
  async getBlob(sha: string) {
    return this.blobs.get(sha)!;
  }
  async createBlob(content: string) {
    const sha = await gitBlobSha(content);
    this.blobs.set(sha, content);
    return sha;
  }
  async createTree(base: string, changes: TreeChange[]) {
    const t = new Map(this.trees.get(base)!);
    for (const c of changes) {
      if (c.sha) {
        if (!this.blobs.has(c.sha)) throw new Error(`missing blob for ${c.path}`);
        t.set(c.path, c.sha);
      } else t.delete(c.path);
    }
    const id = `t${++this.n}`;
    this.trees.set(id, t);
    return id;
  }
  async createCommit(_m: string, tree: string, parent: string) {
    const id = `c${++this.n}`;
    this.commits.set(id, { tree, parent });
    return id;
  }
  async updateRef(commit: string) {
    if (this.rejectNextUpdates > 0) {
      this.rejectNextUpdates--;
      return false;
    }
    if (this.commits.get(commit)!.parent !== this.head) return false;
    this.head = commit;
    this.commitCount++;
    return true;
  }
  files() {
    return [...this.trees.get(this.commits.get(this.head)!.tree)!.keys()].sort();
  }
}

let n = 0;
const open = async () => {
  const d = new QBankDB(`sync-test-${n++}`);
  await d.open();
  return d;
};
let laptop: QBankDB;
let phone: QBankDB;
let repo: FakeRepo;
beforeEach(async () => {
  laptop = await open();
  phone = await open();
  repo = new FakeRepo();
});
afterEach(async () => {
  await laptop.delete();
  await phone.delete();
});

const Q1 = 'B2-W6-D1-L1-Q001';
const Q2 = 'B2-W6-D1-L1-Q002';
const answer = (qid: string, ts: number, correct: boolean, sessionId: string) => ({
  qid,
  ts,
  chosen: 'A',
  correct,
  confidence: 'sure' as const,
  timeMs: 1000,
  mode: 'smart' as const,
  sessionId,
});
const T = new Date(2026, 9, 5, 9).getTime();

describe('shards', () => {
  it('serialize deterministically regardless of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('round-trip the bank (progress counts are rebuilt from answers, not stored)', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await recordAttempts([answer(Q1, T, false, 's1')], laptop);
    await updateProgress(Q2, { flagged: true }, laptop);
    const files = toShards(await readAll(laptop));
    expect([...files.keys()].sort()).toEqual([
      `attempts/2026-10-05.json`,
      'deletions.json',
      'exams.json',
      'imports.json',
      'lectures.json',
      'progress-meta.json',
      'questions/B2-W6-D1-L1.json',
      'questions/B2-W6-D1-L2.json',
    ]);
    const back = fromShards(files);
    expect(back.questions).toHaveLength(10);
    expect(back.attempts).toHaveLength(1);
    expect(back.progress.map((p) => p.qid)).toEqual([Q2]);
  });
});

describe('two devices syncing through one repo', () => {
  it('pushes from one device and pulls into the other', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await recordAttempts([answer(Q1, T, false, 'laptop')], laptop);

    const first = await syncOnce(repo, laptop);
    expect(first.pushed).toBeGreaterThan(0);
    const pulled = await syncOnce(repo, phone);
    expect(pulled.pulled).toBeGreaterThan(0);
    expect(pulled.pushed).toBe(0);

    expect(await phone.questions.count()).toBe(10);
    expect(await phone.progress.get(Q1)).toMatchObject({ timesSeen: 1, lastResult: 'wrong' });
    expect((await phone.progress.get(Q1))?.srs?.box).toBe(1);
  });

  it('answers, flags and unflags flow both ways; quiet syncs make no commits', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await syncOnce(repo, laptop);
    await syncOnce(repo, phone);

    // On the go: phone answers Q2 and flags Q1.
    await recordAttempts([answer(Q2, T + 1000, true, 'phone')], phone);
    await updateProgress(Q1, { flagged: true, note: 'review slide 9' }, phone);
    await syncOnce(repo, phone);
    await syncOnce(repo, laptop);
    expect(await laptop.progress.get(Q2)).toMatchObject({ timesSeen: 1, timesCorrect: 1 });
    expect(await laptop.progress.get(Q1)).toMatchObject({ flagged: true, note: 'review slide 9' });

    // Back home: laptop unflags (a later change) and it sticks on the phone.
    await laptop.progress.update(Q1, { flagged: false, metaUpdatedAt: Date.now() + 5000 });
    await syncOnce(repo, laptop);
    await syncOnce(repo, phone);
    expect(await phone.progress.get(Q1)).toMatchObject({ flagged: false });

    const commits = repo.commitCount;
    expect((await syncOnce(repo, phone)).commit).toBeNull();
    expect((await syncOnce(repo, laptop)).commit).toBeNull();
    expect(repo.commitCount).toBe(commits);
  });

  it('a delete on one device removes it everywhere instead of coming back', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await recordAttempts([answer('B2-W6-D1-L2-Q001', T, true, 'laptop')], laptop);
    await syncOnce(repo, laptop);
    await syncOnce(repo, phone);

    await deleteLectures(['B2-W6-D1-L2'], phone);
    await syncOnce(repo, phone);
    expect(repo.files()).not.toContain('questions/B2-W6-D1-L2.json');
    await syncOnce(repo, laptop);

    expect(await laptop.questions.count()).toBe(6);
    expect(await laptop.lectures.get('B2-W6-D1-L2')).toBeUndefined();
    expect(await laptop.attempts.count()).toBe(0);
  });

  it('re-importing after a delete brings the questions back', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await deleteLectures(['B2-W6-D1-L2'], laptop);
    await syncOnce(repo, laptop);
    await new Promise((r) => setTimeout(r, 5));
    await applyImport(await planImport([{ name: 's', text: sampleText() }], phone), {}, phone);
    await syncOnce(repo, phone);
    await syncOnce(repo, laptop);
    expect(await laptop.questions.count()).toBe(10);
  });

  it('retries when another device commits first, without losing either side', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await syncOnce(repo, laptop);
    await syncOnce(repo, phone);
    await recordAttempts([answer(Q1, T, true, 'laptop')], laptop);
    await recordAttempts([answer(Q2, T, false, 'phone')], phone);

    await syncOnce(repo, laptop);
    repo.rejectNextUpdates = 1; // phone loses one race
    await syncOnce(repo, phone);
    await syncOnce(repo, laptop);

    for (const d of [laptop, phone]) {
      expect(await d.attempts.count()).toBe(2);
      expect(await d.progress.get(Q1)).toMatchObject({ timesCorrect: 1 });
      expect(await d.progress.get(Q2)).toMatchObject({ lastResult: 'wrong' });
    }
  });

  it('a wiped device pulls everything back rather than deleting it from the repo', async () => {
    await applyImport(await planImport([{ name: 's', text: sampleText() }], laptop), {}, laptop);
    await syncOnce(repo, laptop);
    await syncOnce(repo, phone);
    const before = repo.files();

    await phone.delete();
    phone = await open();
    await syncOnce(repo, phone);
    expect(await phone.questions.count()).toBe(10);
    expect(repo.files()).toEqual(before);
  });
});
