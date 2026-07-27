import { describe, expect, it } from 'vitest';
import { tuning } from '../src/config/tuning.ts';
import { makeTestLevel, testContent } from './helpers.ts';
import { initGame, step } from '../src/sim/step.ts';
import { parse } from '../src/sim/parser.ts';
import { tickPulse, faintFailChance } from '../src/sim/pulse.ts';
import { makePlayer } from '../src/sim/player.ts';

function intentsOf(line: string) {
  const r = parse(line);
  if (!r.ok) throw new Error(`parse failed: ${line}`);
  return r.intents;
}

describe('pulse model', () => {
  it('decays exertion and returns pulse toward resting', () => {
    const p = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    p.exertion = 50;
    p.pulse = 120;
    for (let i = 0; i < 3000; i++) tickPulse(p, 0, tuning);
    expect(p.exertion).toBe(0);
    expect(p.pulse).toBeCloseTo(tuning.pulse.resting, 0);
  });

  it('drives pulse up under load', () => {
    const p = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    for (let i = 0; i < 100; i++) {
      p.exertion += 5;
      tickPulse(p, 0, tuning);
    }
    expect(p.pulse).toBeGreaterThan(tuning.pulse.resting + 30);
  });

  it('raises the pulse faster when overloaded', () => {
    const light = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    const heavy = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    for (let i = 0; i < 200; i++) {
      light.exertion += 3;
      heavy.exertion += 3;
      tickPulse(light, 0, tuning);
      tickPulse(heavy, tuning.pulse.weightReference, tuning);
    }
    expect(heavy.pulse).toBeGreaterThan(light.pulse);
  });

  it('produces a fixed pulse curve for a fixed command sequence', () => {
    const content = testContent(makeTestLevel(8, 8));
    const state = initGame(content, 424242);
    const samples: number[] = [];
    const script = intentsOf('M M T R M M T R M M');
    let queue = script;
    for (let t = 0; t < 400; t++) {
      step(content, state, t === 0 ? queue : []);
      if (t % 40 === 0) samples.push(Number(state.player.pulse.toFixed(4)));
    }
    // Snapshot: any change to the pulse model must be deliberate.
    expect(samples).toEqual([
      55.4016, 60.1754, 63.1153, 57.2595, 55.5434, 55.1307, 55.0314, 55.0076, 55.0018, 55.0004,
    ]);
  });

  it('never fails commands below the faint threshold', () => {
    const p = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    p.pulse = tuning.pulse.faintThreshold - 1;
    expect(faintFailChance(p, tuning)).toBe(0);
    p.pulse = tuning.pulse.faintThreshold;
    expect(faintFailChance(p, tuning)).toBeGreaterThan(0);
  });

  it('kills the player when the pulse holds above the ceiling', () => {
    const content = testContent(makeTestLevel(8, 8));
    const state = initGame(content, 7);
    state.player.pulse = tuning.pulse.ceiling + 10;
    state.player.exertion = 500;
    const events = step(content, state, []);
    expect(state.status).toBe('dead');
    expect(events.some((e) => e.type === 'death')).toBe(true);
  });
});
