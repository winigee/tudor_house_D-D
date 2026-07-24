import { describe, expect, it } from 'vitest';
import { loadContent, makeTestLevel, testContent } from './helpers.ts';
import { initGame, step } from '../src/sim/step.ts';
import { spawnCreature } from '../src/sim/creatures.ts';
import { instantiate } from '../src/sim/items.ts';
import type { SimEvent } from '../src/sim/events.ts';

describe('progression and endgame', () => {
  it('climbs down the stairs to the next floor, arriving at its stairs up', () => {
    const content = loadContent();
    const state = initGame(content, 99);
    const down = content.levels[1]!.features.stairsDown![0]!;
    state.player.x = down.at[0];
    state.player.y = down.at[1];
    const events: SimEvent[] = [];
    events.push(...step(content, state, [{ verb: 'CLIMB', dir: 'DOWN' }]));
    for (let t = 0; t < 60; t++) events.push(...step(content, state, []));
    expect(state.player.levelId).toBe(2);
    const up = content.levels[2]!.features.stairsUp!.find((s) => s.to === 1)!;
    expect([state.player.x, state.player.y]).toEqual(up.at);
    expect(events.some((e) => e.type === 'climbed' && e.to === 2)).toBe(true);
    // And back up again.
    for (let t = 0; t < 60; t++) step(content, state, t === 0 ? [{ verb: 'CLIMB', dir: 'UP' }] : []);
    expect(state.player.levelId).toBe(1);
  });

  it('refuses to climb where there are no stairs', () => {
    const content = testContent(makeTestLevel(6, 6));
    const state = initGame(content, 5);
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      events.push(...step(content, state, t === 0 ? [{ verb: 'CLIMB', dir: 'DOWN' }] : []));
    }
    expect(state.player.levelId).toBe(1);
    expect(events.some((e) => e.type === 'message' && e.key === 'no_stairs_down')).toBe(true);
  });

  it('killing the wizard wins the game', () => {
    const content = testContent(makeTestLevel(6, 6));
    const state = initGame(content, 12345);
    state.player.hands.RIGHT = instantiate(content.items['sword_rune']!);
    state.player.hands.RIGHT.identified = true;
    // Wizard in the cell ahead (facing E from 1,1).
    state.creatures.push(spawnCreature(content.creatures, state.uidCounter++, 'wizard', 1, 2, 1, -1));
    const events: SimEvent[] = [];
    let guard = 0;
    while (state.status === 'playing' && guard++ < 3000) {
      const wizardAlive = state.creatures.some((c) => c.defId === 'wizard' && c.hp > 0);
      expect(wizardAlive || state.status !== 'playing').toBeTruthy();
      const idle = !state.current && state.queue.length === 0;
      events.push(
        ...step(content, state, idle ? [{ verb: 'ATTACK', hand: 'RIGHT' }] : []),
      );
      // Keep the pulse safe so the duel ends by the sword, not the heart.
      state.player.pulse = Math.min(state.player.pulse, 150);
    }
    expect(state.status).toBe('won');
    expect(events.some((e) => e.type === 'victory')).toBe(true);
    expect(events.some((e) => e.type === 'creatureDied' && e.defId === 'wizard')).toBe(true);
  });

  it('respawns creatures up to their cap on the active floor', () => {
    const content = loadContent();
    const state = initGame(content, 2024);
    const level1 = content.levels[1]!;
    const spawnIndex = 0;
    const spawn = level1.creatureSpawns[spawnIndex]!;
    expect(spawn.respawn).toBeDefined();
    // Remove every creature from that spawn, then wait for the timer.
    state.creatures = state.creatures.filter(
      (c) => !(c.levelId === 1 && c.spawnIndex === spawnIndex),
    );
    for (let t = 0; t < spawn.respawn!.afterTicks + 60; t++) step(content, state, []);
    const count = state.creatures.filter((c) => c.levelId === 1 && c.spawnIndex === spawnIndex).length;
    expect(count).toBeGreaterThan(0);
  });
});
