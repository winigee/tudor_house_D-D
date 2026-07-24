// Replay harness: run recorded command logs against fixed seeds and
// compare the final state hash to a stored value. One replay per
// milestone; a hash change means the simulation changed behaviour.

import { describe, expect, it } from 'vitest';
import { loadContent, makeTestLevel, testContent } from './helpers.ts';
import { initGame, step, hashGame, serializeGame, deserializeGame } from '../src/sim/step.ts';
import { parse, type CommandIntent } from '../src/sim/parser.ts';

interface Replay {
  name: string;
  seed: number;
  /** Lines submitted at given ticks. */
  script: { atTick: number; line: string }[];
  runTicks: number;
  expectedHash: string;
}

// Milestone replays. To regenerate a hash after a deliberate sim change,
// run `npx vitest run tests/replay.test.ts` and read the reported actual.
const REPLAYS: Replay[] = [
  {
    name: 'm2-items-and-walking',
    seed: 20001,
    script: [
      { atTick: 0, line: 'PULL TORCH LEFT' },
      { atTick: 40, line: 'USE LEFT' },
      { atTick: 80, line: 'PULL SWORD RIGHT' },
      { atTick: 120, line: 'M M T R M LOOK' },
      { atTick: 400, line: 'STOW RIGHT DROP LEFT GET LEFT' },
    ],
    runTicks: 800,
    expectedHash: '08408dca',
  },
  {
    name: 'm3-pulse-under-load',
    seed: 30001,
    script: [
      { atTick: 0, line: 'M M M M M M M M M M M M B B B B T A M M M M' },
      { atTick: 400, line: 'T L M M T R M M M M B B' },
    ],
    runTicks: 1200,
    expectedHash: '82073c57',
  },
  {
    name: 'm4-first-blood',
    seed: 40001,
    script: [
      { atTick: 0, line: 'PULL TORCH LEFT' },
      { atTick: 30, line: 'USE LEFT PULL SWORD RIGHT' },
      { atTick: 90, line: 'A R A R A R A R A R A R' },
      { atTick: 600, line: 'A R A R A R A R' },
    ],
    runTicks: 1500,
    expectedHash: 'be33b357',
  },
  {
    name: 'm5-full-floor-walk',
    seed: 50001,
    script: [
      { atTick: 0, line: 'PULL TORCH LEFT' },
      { atTick: 30, line: 'USE LEFT' },
      { atTick: 60, line: 'M M M T R M M T L M M M M B T A M M' },
      { atTick: 800, line: 'LOOK EXAMINE LEFT' },
      { atTick: 900, line: 'INCANT VESPER' },
    ],
    runTicks: 2000,
    expectedHash: '8822d663',
  },
];

function submissionsFor(replay: Replay): Map<number, CommandIntent[]> {
  const map = new Map<number, CommandIntent[]>();
  for (const s of replay.script) {
    const r = parse(s.line);
    if (!r.ok) throw new Error(`replay ${replay.name}: parse failed for "${s.line}"`);
    map.set(s.atTick, r.intents);
  }
  return map;
}

describe('replay harness', () => {
  for (const replay of REPLAYS) {
    it(`replays ${replay.name} to a stable hash`, () => {
      const content = loadContent();
      const state = initGame(content, replay.seed);
      const subs = submissionsFor(replay);
      for (let t = 0; t < replay.runTicks; t++) {
        step(content, state, subs.get(t) ?? []);
      }
      const hash = hashGame(state);
      expect(hash).toBe(replay.expectedHash);
    });
  }

  it('produces identical hashes for identical runs', () => {
    const content = loadContent();
    const a = initGame(content, 777);
    const b = initGame(content, 777);
    const line = parse('PULL TORCH LEFT');
    if (!line.ok) throw new Error('parse failed');
    for (let t = 0; t < 300; t++) {
      step(content, a, t === 0 ? line.intents : []);
      step(content, b, t === 0 ? line.intents : []);
    }
    expect(hashGame(a)).toBe(hashGame(b));
  });

  it('diverges for different seeds', () => {
    const content = loadContent();
    const a = initGame(content, 1);
    const b = initGame(content, 2);
    for (let t = 0; t < 300; t++) {
      step(content, a, []);
      step(content, b, []);
    }
    expect(hashGame(a)).not.toBe(hashGame(b));
  });

  it('survives a save/load round trip mid-run', () => {
    const content = testContent(makeTestLevel(8, 8));
    const a = initGame(content, 555);
    const line = parse('M M T R M M');
    if (!line.ok) throw new Error('parse failed');
    for (let t = 0; t < 100; t++) step(content, a, t === 0 ? line.intents : []);
    const saved = serializeGame(a);
    const b = deserializeGame(content, saved);
    for (let t = 0; t < 200; t++) {
      step(content, a, []);
      step(content, b, []);
    }
    expect(hashGame(a)).toBe(hashGame(b));
  });

  it('refuses a save from a different schema version', () => {
    const content = testContent(makeTestLevel(4, 4));
    const state = initGame(content, 1);
    const saved = serializeGame(state);
    saved.schemaVersion = 999;
    expect(() => deserializeGame(content, saved)).toThrow(/schema version/i);
  });

  it('runs ten thousand ticks headless well under budget', () => {
    const content = loadContent();
    const state = initGame(content, 123);
    const start = performance.now();
    for (let t = 0; t < 10_000; t++) step(content, state, []);
    const elapsed = performance.now() - start;
    // Spec budget: under 2 ms per tick. Assert a loose ceiling.
    expect(elapsed / 10_000).toBeLessThan(2);
  });
});
