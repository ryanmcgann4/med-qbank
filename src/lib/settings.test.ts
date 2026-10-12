import { describe, expect, it } from 'vitest';
import { emptyProgress } from './progress';
import { isLeech, missCount } from './settings';

const seen = (timesSeen: number, timesCorrect: number, archived = false) => ({ ...emptyProgress('q'), timesSeen, timesCorrect, archived });

describe('misses and leeches', () => {
  it('counts misses as answers that were wrong', () => {
    expect(missCount(undefined)).toBe(0);
    expect(missCount(seen(5, 2))).toBe(3);
  });

  it('a question becomes a leech at the threshold, unless archived or the setting is off', () => {
    expect(isLeech(seen(6, 2), 5)).toBe(false); // 4 misses
    expect(isLeech(seen(7, 2), 5)).toBe(true); // 5 misses
    expect(isLeech(seen(7, 2, true), 5)).toBe(false);
    expect(isLeech(seen(20, 0), 0)).toBe(false);
    expect(isLeech(undefined, 5)).toBe(false);
  });
});
