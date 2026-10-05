export type Rng = () => number;

/** Small seeded PRNG (mulberry32) so selection is reproducible in tests. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis): each item gets
 * key u^(1/w) and the `k` largest keys win. Heavier items are picked more often.
 */
export function weightedSample<T>(items: readonly T[], weight: (t: T) => number, k: number, rng: Rng = Math.random): T[] {
  return items
    .map((item) => {
      const w = Math.max(weight(item), 1e-6);
      return { item, key: Math.pow(rng(), 1 / w) };
    })
    .sort((x, y) => y.key - x.key)
    .slice(0, k)
    .map((x) => x.item);
}

export function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
