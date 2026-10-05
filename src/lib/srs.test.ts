import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from './dates';
import { schedule } from './srs';
import { applyAttempt } from './tracking';
import { hasStatus } from './status';

const NOW = new Date(2026, 9, 5, 14, 30).getTime(); // Oct 5 2026, 2:30pm local
const wait = (s: { dueAt: number }, from = NOW) => daysBetween(from, s.dueAt);

describe('schedule', () => {
  it('wrong answers come back tomorrow in box 1', () => {
    const s = schedule({ box: 5, dueAt: NOW, lastReviewedAt: 0 }, false, 'sure', NOW);
    expect(s.box).toBe(1);
    expect(wait(s)).toBe(1);
  });

  it('a correct guess is treated like a miss for scheduling', () => {
    const s = schedule({ box: 4, dueAt: NOW, lastReviewedAt: 0 }, true, 'guess', NOW);
    expect(s).toMatchObject({ box: 1 });
    expect(wait(s)).toBe(1);
  });

  it('right-but-unsure comes back sooner than right-and-sure', () => {
    const prev = { box: 3, dueAt: NOW, lastReviewedAt: 0 };
    const unsure = schedule(prev, true, 'unsure', NOW);
    const sure = schedule(prev, true, 'sure', NOW);
    expect(unsure.box).toBe(3);
    expect(wait(unsure)).toBe(4); // half of 7, rounded up
    expect(sure.box).toBe(4);
    expect(wait(sure)).toBe(14);
    expect(wait(unsure)).toBeLessThan(wait(sure));
  });

  it('new questions answered sure go to box 2 (3 days); unsure stay in box 1 (1 day)', () => {
    expect(schedule(null, true, 'sure', NOW)).toMatchObject({ box: 2 });
    expect(wait(schedule(null, true, 'sure', NOW))).toBe(3);
    expect(schedule(null, true, 'unsure', NOW)).toMatchObject({ box: 1 });
    expect(wait(schedule(null, true, 'unsure', NOW))).toBe(1);
  });

  it('answering before the due date does not promote', () => {
    const prev = { box: 3, dueAt: addDays(NOW, 5), lastReviewedAt: 0 };
    const s = schedule(prev, true, 'sure', NOW);
    expect(s.box).toBe(3);
    expect(wait(s)).toBe(7);
  });

  it('caps at box 6 (60 days)', () => {
    const s = schedule({ box: 6, dueAt: NOW, lastReviewedAt: 0 }, true, 'sure', NOW);
    expect(s.box).toBe(6);
    expect(wait(s)).toBe(60);
  });

  it('due dates land on local midnight', () => {
    const s = schedule(null, false, null, NOW);
    expect(new Date(s.dueAt).getHours()).toBe(0);
  });
});

describe('progress + statuses', () => {
  it('mastered after three spaced, confident correct answers; a miss resets it', () => {
    let p = applyAttempt(undefined, 'q', { correct: true, confidence: 'sure', ts: NOW });
    expect(hasStatus(p, 'mastered', NOW)).toBe(false);
    let t = p.srs!.dueAt + 1;
    p = applyAttempt(p, 'q', { correct: true, confidence: 'sure', ts: t });
    expect(hasStatus(p, 'mastered', t)).toBe(false);
    t = p.srs!.dueAt + 1;
    p = applyAttempt(p, 'q', { correct: true, confidence: 'sure', ts: t });
    expect(p.srs!.box).toBe(4);
    expect(hasStatus(p, 'mastered', t)).toBe(true);

    p = applyAttempt(p, 'q', { correct: false, confidence: 'sure', ts: t + 1000 });
    expect(hasStatus(p, 'mastered', t)).toBe(false);
    expect(hasStatus(p, 'missed', t)).toBe(true);
    expect(hasStatus(p, 'ever_missed', t)).toBe(true);
    expect(p.streak).toBe(0);
  });

  it('flags lucky guesses and due questions', () => {
    const p = applyAttempt(undefined, 'q', { correct: true, confidence: 'guess', ts: NOW });
    expect(hasStatus(p, 'lucky', NOW)).toBe(true);
    expect(hasStatus(p, 'due', NOW)).toBe(false);
    expect(hasStatus(p, 'due', addDays(NOW, 1))).toBe(true);
    expect(hasStatus(undefined, 'unseen', NOW)).toBe(true);
  });
});
