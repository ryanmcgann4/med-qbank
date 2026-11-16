import { afterEach, describe, expect, it } from 'vitest';
import { addDays, daysBetween, parseDay, setTimeZone, startOfDay, todayISO } from './dates';
import { schedule } from './srs';

afterEach(() => setTimeZone(null));

describe('day math in a named time zone (the connector runs in UTC)', () => {
  // 8:30 pm on Nov 16 in Chicago is already Nov 17 in UTC.
  const evening = Date.UTC(2026, 10, 17, 2, 30);

  it('uses that zone\'s calendar day, not the machine\'s', () => {
    setTimeZone('America/Chicago');
    expect(todayISO(evening)).toBe('2026-11-16');
    expect(startOfDay(evening)).toBe(Date.UTC(2026, 10, 16, 6)); // midnight CST
    expect(addDays(evening, 1)).toBe(Date.UTC(2026, 10, 17, 6));
    expect(parseDay('2026-11-20')).toBe(Date.UTC(2026, 10, 20, 6));
    expect(daysBetween(evening, parseDay('2026-11-20'))).toBe(4);
  });

  it('a question answered in the evening is due at the next local midnight', () => {
    setTimeZone('America/Chicago');
    const srs = schedule(null, false, 'sure', evening);
    expect(srs.dueAt).toBe(Date.UTC(2026, 10, 17, 6));
    expect(srs.dueAt).toBeGreaterThan(evening); // not already due
  });

  it('handles the days the clocks change', () => {
    setTimeZone('America/Chicago');
    const beforeSpring = Date.UTC(2027, 2, 13, 18); // noon CST, Mar 13 2027
    expect(addDays(beforeSpring, 1)).toBe(Date.UTC(2027, 2, 14, 6)); // midnight is still CST
    expect(addDays(beforeSpring, 2)).toBe(Date.UTC(2027, 2, 15, 5)); // CDT from here
    const beforeFall = Date.UTC(2027, 10, 6, 17); // noon CDT, Nov 6 2027
    expect(addDays(beforeFall, 2)).toBe(Date.UTC(2027, 10, 8, 6));
    expect(daysBetween(beforeSpring, addDays(beforeSpring, 30))).toBe(30);
  });

  it('matches the machine\'s own zone when none is named', () => {
    const d = new Date(2026, 5, 15, 13, 45);
    expect(startOfDay(d.getTime())).toBe(new Date(2026, 5, 15).getTime());
    expect(addDays(d.getTime(), 20)).toBe(new Date(2026, 6, 5).getTime());
    expect(parseDay('2026-06-15')).toBe(new Date(2026, 5, 15).getTime());
    expect(todayISO(d.getTime())).toBe('2026-06-15');
  });
});
