import { describe, expect, it } from 'vitest';
import { stepChoice } from './choiceStep';

const order = ['c', 'a', 'e', 'b', 'd'];

describe('stepChoice', () => {
  it('starts at the first choice going down and the last going up', () => {
    expect(stepChoice(order, null, [], 1)).toBe('c');
    expect(stepChoice(order, null, [], -1)).toBe('d');
  });

  it('moves in display order and wraps around', () => {
    expect(stepChoice(order, 'a', [], 1)).toBe('e');
    expect(stepChoice(order, 'a', [], -1)).toBe('c');
    expect(stepChoice(order, 'd', [], 1)).toBe('c');
    expect(stepChoice(order, 'c', [], -1)).toBe('d');
  });

  it('skips crossed-out choices', () => {
    expect(stepChoice(order, 'c', ['a', 'e'], 1)).toBe('b');
    expect(stepChoice(order, null, ['c'], 1)).toBe('a');
    expect(stepChoice(order, 'b', ['e', 'a', 'c'], -1)).toBe('d');
  });

  it('treats a selection missing from the order like no selection', () => {
    expect(stepChoice(order, 'zz', [], 1)).toBe('c');
  });

  it('returns null when nothing can be picked', () => {
    expect(stepChoice(order, 'a', order, 1)).toBeNull();
    expect(stepChoice([], null, [], 1)).toBeNull();
  });
});
