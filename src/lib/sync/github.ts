export interface SyncConfig {
  /** `owner/name` of a private repo that has at least one commit (e.g. a README). */
  repo: string;
  branch: string;
  /** Fine-grained token with Contents: read & write on that repo only. */
  token: string;
}

export interface Head {
  commit: string;
  tree: string;
}

export interface TreeChange {
  path: string;
  /** null deletes the path. */
  sha: string | null;
}

/** The handful of Git operations sync needs; swapped for an in-memory fake in tests. */
export interface RepoClient {
  getHead(): Promise<Head>;
  /** path → blob sha for every file. */
  getTree(tree: string): Promise<Map<string, string>>;
  getBlob(sha: string): Promise<string>;
  createBlob(content: string): Promise<string>;
  createTree(base: string, changes: TreeChange[]): Promise<string>;
  createCommit(message: string, tree: string, parent: string): Promise<string>;
  /** False when someone else moved the branch first (not a fast-forward). */
  updateRef(commit: string): Promise<boolean>;
}

export class SyncError extends Error {
  kind: 'auth' | 'not_found' | 'empty' | 'network' | 'other';
  constructor(kind: SyncError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export class GitHubClient implements RepoClient {
  private cfg: SyncConfig;
  private userAgent?: string;
  /** `userAgent` is required outside browsers (GitHub rejects requests without one). */
  constructor(cfg: SyncConfig, { userAgent }: { userAgent?: string } = {}) {
    this.cfg = cfg;
    this.userAgent = userAgent;
  }

  private async call(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${this.cfg.repo}${path}`, {
        ...init,
        cache: 'no-store',
        headers: {
          Accept: init.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${this.cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.userAgent ? { 'User-Agent': this.userAgent } : {}),
        },
      });
    } catch {
      throw new SyncError('network', "Couldn't reach GitHub. You may be offline.");
    }
    if (res.status === 401) throw new SyncError('auth', 'GitHub rejected the token. It may have expired; create a new one.');
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new SyncError('other', 'GitHub rate limit reached; sync will retry later.');
    if (res.status === 403 || res.status === 404) {
      throw new SyncError('not_found', `Can't access ${this.cfg.repo}. Check the repo name and that the token has Contents read & write on it.`);
    }
    if (res.status === 409) throw new SyncError('empty', `${this.cfg.repo} is empty. Add a README on GitHub so it has a first commit.`);
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.call(path, init);
    if (!res.ok) throw new SyncError('other', `GitHub error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
  }

  async getHead(): Promise<Head> {
    const ref = await this.json<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(this.cfg.branch)}`);
    const commit = await this.json<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: commit.tree.sha };
  }

  async getTree(tree: string): Promise<Map<string, string>> {
    const t = await this.json<{ tree: { path: string; sha: string; type: string }[]; truncated: boolean }>(`/git/trees/${tree}?recursive=1`);
    if (t.truncated) throw new SyncError('other', 'The sync repo has too many files for one listing.');
    return new Map(t.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
  }

  async getBlob(sha: string): Promise<string> {
    const res = await this.call(`/git/blobs/${sha}`, { raw: true });
    if (!res.ok) throw new SyncError('other', `GitHub error ${res.status} reading a file`);
    return res.text();
  }

  async createBlob(content: string): Promise<string> {
    return (await this.json<{ sha: string }>('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) })).sha;
  }

  async createTree(base: string, changes: TreeChange[]): Promise<string> {
    const tree = changes.map((c) => ({ path: c.path, mode: '100644', type: 'blob', sha: c.sha }));
    return (await this.json<{ sha: string }>('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base, tree }) })).sha;
  }

  async createCommit(message: string, tree: string, parent: string): Promise<string> {
    return (await this.json<{ sha: string }>('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree, parents: [parent] }) })).sha;
  }

  async updateRef(commit: string): Promise<boolean> {
    const res = await this.call(`/git/refs/heads/${encodeURIComponent(this.cfg.branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit, force: false }),
    });
    if (res.status === 422) return false;
    if (!res.ok) throw new SyncError('other', `GitHub error ${res.status} saving the sync`);
    return true;
  }

  /** Cheap check used when connecting: does the token see the repo, and is it private? */
  async checkRepo(): Promise<{ private: boolean; defaultBranch: string }> {
    const r = await this.json<{ private: boolean; default_branch: string }>('');
    return { private: r.private, defaultBranch: r.default_branch };
  }
}
