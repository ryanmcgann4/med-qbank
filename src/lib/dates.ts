export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days are your local days. Code that doesn't run on your device (the Claude
 * connector runs on a server in UTC) names your time zone here, so "today",
 * "due" and exam countdowns mean the same there as in the app.
 */
let zone: Intl.DateTimeFormat | null = null;
export function setTimeZone(tz: string | null): void {
  zone = tz
    ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
}

/** Wall-clock fields of `t` in the chosen zone: [year, month (0-based), day, hour, minute, second]. */
function wall(t: number): number[] {
  if (!zone) {
    const d = new Date(t);
    return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  }
  const p: Record<string, number> = {};
  for (const { type, value } of zone.formatToParts(new Date(t))) p[type] = Number(value);
  return [p.year, p.month - 1, p.day, p.hour, p.minute, p.second];
}

/** The moment calendar day (y, m, d) starts; `d` may run past the month's end. */
function midnight(y: number, m: number, d: number): number {
  if (!zone) return new Date(y, m, d).getTime();
  const target = Date.UTC(y, m, d);
  let t = target;
  // Shift by the zone's UTC offset at that moment; a second pass settles days when the offset changes (DST).
  for (let i = 0; i < 2; i++) {
    const [wy, wm, wd, wh, wmin, ws] = wall(t);
    t -= Date.UTC(wy, wm, wd, wh, wmin, ws) - target;
  }
  return t;
}

/** Local midnight at the start of the day containing `t`. */
export function startOfDay(t: number): number {
  const [y, m, d] = wall(t);
  return midnight(y, m, d);
}

/** Local midnight `n` calendar days after the day containing `t` (DST-safe). */
export function addDays(t: number, n: number): number {
  const [y, m, d] = wall(t);
  return midnight(y, m, d + n);
}

/** Local midnight at the start of a YYYY-MM-DD date. */
export function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return midnight(y, m - 1, d);
}

/** Whole calendar days from the day of `from` to the day of `to`. */
export function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

export function formatDate(t: number | string | null | undefined): string {
  if (t === null || t === undefined) return '—';
  const d = typeof t === 'string' ? new Date(t + (t.length === 10 ? 'T00:00:00' : '')) : new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "in 3 days", "tomorrow", "today", "2 days ago" relative to now. */
export function relativeDay(t: number, now = Date.now()): string {
  const n = daysBetween(now, t);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function todayISO(now = Date.now()): string {
  const [y, m, d] = wall(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
