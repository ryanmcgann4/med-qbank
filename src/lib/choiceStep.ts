/**
 * The answer choice one step up (delta -1) or down (delta +1) from the selected one, in display
 * order, wrapping around and skipping crossed-out choices. With nothing selected, down starts at
 * the first choice and up at the last. Returns null when every choice is crossed out.
 * Used by the ↑/↓ keys (and so by a remote's joystick, mapped to them).
 */
export function stepChoice(order: readonly string[], chosen: string | null, struck: readonly string[], delta: 1 | -1): string | null {
  const n = order.length;
  if (n === 0) return null;
  const from = chosen === null ? -1 : order.indexOf(chosen);
  let j = from === -1 ? (delta === 1 ? -1 : n) : from;
  for (let tries = 0; tries < n; tries++) {
    j = (((j + delta) % n) + n) % n;
    if (!struck.includes(order[j])) return order[j];
  }
  return null;
}
