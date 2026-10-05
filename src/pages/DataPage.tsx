import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Cloud, ClipboardCopy, DatabaseBackup, Download, ExternalLink, HardDrive, Layers, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Chip, cn, Field, inputClass, Modal, PageHeader, SectionTitle } from '../components/ui';
import { db, getKV, type StatusKey } from '../db';
import { useCandidates } from '../hooks/useBank';
import { ankiCsv } from '../lib/anki';
import { downloadBackup, LAST_BACKUP_KEY, parseBackup, restoreBackup, type BackupFile } from '../lib/backup';
import { formatDate, relativeDay, todayISO } from '../lib/dates';
import { downloadText } from '../lib/download';
import { emptyFilters, matchesFilters, weekKey } from '../lib/selection';
import { STATUS_LABELS } from '../lib/status';
import { useSyncState } from '../hooks/useSync';
import { connect, disconnect, parseSetupCode, setupCode, syncNow } from '../lib/sync/controller';

const ANKI_STATUSES: StatusKey[] = ['missed', 'ever_missed', 'lucky', 'flagged', 'reported', 'mastered'];

export function DataPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Your data" subtitle="Everything lives in this browser only. Back up regularly, and use backups to move between devices." />
      <SyncSection />
      <BackupSection />
      <AnkiSection />
      <StorageSection />
    </div>
  );
}

function SyncSection() {
  const sync = useSyncState();
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function run(cfg: { repo: string; token: string; branch: string }) {
    setBusy(true);
    setError(null);
    try {
      await connect(cfg);
      setToken('');
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    const c = setupCode();
    if (!c) return;
    await navigator.clipboard.writeText(c);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const title = (
    <span className="inline-flex items-center gap-2">
      <Cloud className="h-5 w-5 text-indigo-600" /> Sync across devices
    </span>
  );

  if (sync.configured) {
    return (
      <Card className="p-5">
        <SectionTitle hint="Syncs when you open the app, when you leave it (e.g. lock your phone), about 15 seconds after you answer, and every few minutes.">
          {title}
        </SectionTitle>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {sync.status === 'error' ? (
            <Badge tone="amber">Sync issue</Badge>
          ) : sync.status === 'syncing' ? (
            <Badge tone="indigo">Syncing…</Badge>
          ) : (
            <Badge tone="green">On</Badge>
          )}
          <span className="text-slate-600 dark:text-slate-400">
            Repo <code className="text-slate-900 dark:text-slate-100">{sync.repo}</code>
            {sync.lastSyncedAt && ` · last synced ${formatDate(sync.lastSyncedAt)} ${new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
          </span>
        </div>
        {sync.error && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{sync.error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
            <RefreshCw className={cn('h-4 w-4', sync.status === 'syncing' && 'animate-spin')} /> Sync now
          </Button>
          <Button variant="secondary" onClick={copyCode}>
            {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy setup code for another device'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmOff(true)}>
            Turn off on this device
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The setup code contains your access token. Send it only to yourself (AirDrop, Notes), then paste it on the other device&apos;s Data page.
        </p>
        <Modal open={confirmOff} onClose={() => setConfirmOff(false)} title="Turn off sync on this device?">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Your questions stay on this device and in the repo; they just stop syncing here. The token is removed from this browser.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOff(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                disconnect();
                setConfirmOff(false);
              }}
            >
              Turn off
            </Button>
          </div>
        </Modal>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <SectionTitle hint="Answer on your phone, pick up on your laptop. Your data goes to a private GitHub repository you own, and every sync is a saved version.">
        {title}
      </SectionTitle>

      <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
        <div className="text-sm font-semibold">Already set up on another device?</div>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
          On that device: Data → <b>Copy setup code</b>. Paste it here.
        </p>
        <div className="mt-2 flex gap-2">
          <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="qbank-sync-1:…" autoComplete="off" spellCheck={false} />
          <Button
            disabled={!code.trim() || busy}
            onClick={() => {
              try {
                void run(parseSetupCode(code));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Connect
          </Button>
        </div>
      </div>

      <details className="mt-4" open={!code}>
        <summary className="cursor-pointer text-sm font-semibold">First device: connect a repository</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            Have a <b>private</b> GitHub repository with a README (e.g. <code>qbank-data</code>).{' '}
            <a className="inline-flex items-center gap-0.5 text-indigo-600 underline dark:text-indigo-400" href="https://github.com/new" target="_blank" rel="noreferrer">
              New repository <ExternalLink className="h-3 w-3" />
            </a>
          </li>
          <li>
            Create a token:{' '}
            <a
              className="inline-flex items-center gap-0.5 text-indigo-600 underline dark:text-indigo-400"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              Fine-grained token <ExternalLink className="h-3 w-3" />
            </a>
            . Set <b>Repository access → Only select repositories →</b> your data repo, and <b>Permissions → Contents → Read and write</b>. Pick an
            expiration you&apos;re comfortable with (up to a year).
          </li>
          <li>Paste both below.</li>
        </ol>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Repository" hint="owner/name">
            <input className={inputClass} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="ryanmcgann4/qbank-data" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Token" hint="Stays in this browser only">
            <input type="password" className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
          </Field>
        </div>
        <Button className="mt-3" disabled={!repo.trim() || !token.trim() || busy} onClick={() => void run({ repo, token, branch: '' })}>
          {busy ? 'Connecting…' : 'Connect & sync'}
        </Button>
      </details>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}

function BackupSection() {
  const lastBackup = useLiveQuery(() => getKV<number | null>(LAST_BACKUP_KEY, null), []);
  const counts = useLiveQuery(async () => ({ q: await db.questions.count(), a: await db.attempts.count() }), []);
  const [pending, setPending] = useState<{ name: string; file: BackupFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(files: FileList | null) {
    setError(null);
    setDone(null);
    const f = files?.[0];
    if (!f) return;
    const { data, error } = parseBackup(await f.text());
    if (error) setError(error);
    else setPending({ name: f.name, file: data! });
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!pending) return;
    setBusy(true);
    try {
      if (mode === 'replace' && (counts?.q ?? 0) > 0) await downloadBackup(); // safety copy first
      const result = await restoreBackup(pending.file, mode);
      setDone(`${mode === 'merge' ? 'Merged' : 'Restored'}: ${result.questions.length} questions and ${result.attempts.length} answers now in this browser.`);
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <SectionTitle hint="One JSON file with every question, lecture, answer, note, flag, and quiz.">
        <span className="inline-flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-indigo-600" /> Backup & restore
        </span>
      </SectionTitle>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Last backup: <b className="text-slate-900 dark:text-slate-100">{lastBackup ? `${formatDate(lastBackup)} (${relativeDay(lastBackup)})` : 'never'}</b>
        {counts && ` · ${counts.q} questions · ${counts.a} answers`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void downloadBackup()} disabled={!counts?.q}>
          <Download className="h-4 w-4" /> Download backup
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" /> Restore from backup…
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {done && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}

      <Modal open={!!pending} onClose={() => setPending(null)} title="Restore backup">
        {pending && (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <b>{pending.name}</b> · saved {formatDate(pending.file.exported_at)}
              <br />
              {pending.file.questions.length} questions · {pending.file.lectures.length} lectures · {pending.file.attempts.length} answers
            </p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => restore('merge')}
                className="block w-full rounded-lg border-2 border-indigo-500 p-3 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              >
                <div className="font-semibold">Merge (recommended)</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Combine with what's here. Answer histories from both are kept and progress is recalculated, which is how you sync a phone and a laptop.
                </div>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => restore('replace')}
                className="block w-full rounded-lg border border-slate-300 p-3 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <div className="font-semibold">Replace everything</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Make this browser an exact copy of the backup. A backup of your current data downloads first.
                </div>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Card>
  );
}

function AnkiSection() {
  const cands = useCandidates();
  const [statuses, setStatuses] = useState<StatusKey[]>(['missed']);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [deck, setDeck] = useState('Q-Bank');
  const now = Date.now();

  const weekOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cands ?? []) if (c.lecture) m.set(weekKey(c.lecture.course, c.lecture.week), `${c.lecture.course} · W${c.lecture.week}`);
    return [...m].sort();
  }, [cands]);

  if (!cands) return null;
  const selected = cands.filter((c) => matchesFilters(c, { ...emptyFilters(), statuses, weeks }, now));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Card className="p-5">
      <SectionTitle hint="Front = stem + options · Back = answer + explanation + takeaway + source · tags by course, week, and lecture.">
        <span className="inline-flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" /> Export to Anki
        </span>
      </SectionTitle>
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium">Which questions? <span className="font-normal text-slate-500">· any selected · none = all</span></div>
          <div className="flex flex-wrap gap-2">
            {ANKI_STATUSES.map((s) => (
              <Chip key={s} selected={statuses.includes(s)} onClick={() => setStatuses(toggle(statuses, s))}>
                {STATUS_LABELS[s]}
              </Chip>
            ))}
          </div>
        </div>
        {weekOptions.length > 1 && (
          <div>
            <div className="mb-2 text-sm font-medium">Weeks <span className="font-normal text-slate-500">· none = all</span></div>
            <div className="flex flex-wrap gap-2">
              {weekOptions.map(([k, label]) => (
                <Chip key={k} selected={weeks.includes(k)} onClick={() => setWeeks(toggle(weeks, k))}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div className="max-w-xs">
          <Field label="Anki deck name">
            <input className={inputClass} value={deck} onChange={(e) => setDeck(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!selected.length}
            onClick={() => downloadText(ankiCsv(selected, deck.trim() || 'Q-Bank'), `qbank-anki-${todayISO()}.csv`, 'text/csv')}
          >
            <Download className="h-4 w-4" /> Download CSV ({selected.length})
          </Button>
          <span className="text-sm text-slate-500">In Anki: File → Import → pick the file. Columns and deck are set automatically.</span>
        </div>
      </div>
    </Card>
  );
}

function StorageSection() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`));
  }, []);

  async function wipe() {
    await db.delete();
    location.hash = '#/';
    location.reload();
  }

  return (
    <Card className="p-5">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-indigo-600" /> Storage
        </span>
      </SectionTitle>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {persisted === null ? null : persisted ? (
          <Badge tone="green">Protected from automatic clearing</Badge>
        ) : (
          <>
            <Badge tone="amber">Browser may clear this data under storage pressure</Badge>
            <Button size="sm" variant="secondary" onClick={() => void navigator.storage.persist().then(setPersisted)}>
              Ask the browser to keep it
            </Button>
          </>
        )}
        {usage && <span className="text-slate-500">Using {usage}</span>}
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        On iPhone, add Q-Bank to your Home Screen (Share → Add to Home Screen). Safari can clear data for sites you haven't opened in a while; installed apps are exempt.
      </p>

      <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button variant="ghost" className="text-rose-600" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" /> Delete everything…
        </Button>
      </div>
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete all data in this browser?">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          This permanently removes every question, lecture, answer, note, and quiz stored here. Download a backup first if you might want it back. If sync
          is on, this only clears this device: the next sync downloads everything again from your other devices.
        </p>
        <div className="mt-3">
          <Field label='Type "delete" to confirm'>
            <input className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={confirm.trim().toLowerCase() !== 'delete'} onClick={wipe}>
            Delete everything
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
