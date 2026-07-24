import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng.ts';
import { tuning } from '../src/config/tuning.ts';
import { makeTestLevel, testContent } from './helpers.ts';
import { initGame, step } from '../src/sim/step.ts';
import { spawnCreature } from '../src/sim/creatures.ts';
import { resolveSwing, resolveCreatureAttack, rollDamage } from '../src/sim/combat.ts';
import { instantiate, type WeaponDef, type ShieldDef } from '../src/sim/items.ts';
import { validateItems } from '../src/sim/items.ts';
import { validateCreatures } from '../src/sim/creatures.ts';
import itemsRaw from '../src/data/items.json';
import creaturesRaw from '../src/data/creatures.json';
import type { SimEvent } from '../src/sim/events.ts';
import { makePlayer } from '../src/sim/player.ts';

const items = validateItems(itemsRaw, 'items.json');
const creatures = validateCreatures(creaturesRaw, 'creatures.json');

describe('combat', () => {
  it('rolls damage deterministically for a fixed seed', () => {
    const rng = new Rng(1234);
    const rolls = Array.from({ length: 8 }, () => rollDamage(rng, [1, 6]));
    const rng2 = new Rng(1234);
    const rolls2 = Array.from({ length: 8 }, () => rollDamage(rng2, [1, 6]));
    expect(rolls).toEqual(rolls2);
    for (const r of rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  it('applies damage type multipliers', () => {
    const rng = new Rng(99);
    const weapon = items['sword_rune'] as WeaponDef; // fire
    const inst = instantiate(weapon);
    const spider = spawnCreature(creatures, 1, 'spider', 1, 2, 2, 0); // fire x1.5
    const hpBefore = spider.hp;
    const out = resolveSwing(rng, { def: weapon, inst }, spider, creatures);
    expect(out.hit).toBe(true);
    const raw = hpBefore - spider.hp;
    expect(raw).toBeGreaterThanOrEqual(Math.round(weapon.damage[0] * 1.5));
    expect(raw).toBeLessThanOrEqual(Math.round(weapon.damage[1] * 1.5));
  });

  it('decays weapon durability and breaks at zero', () => {
    const rng = new Rng(5);
    const weapon = items['dagger'] as WeaponDef;
    const inst = instantiate(weapon);
    inst.durability = 2;
    const first = resolveSwing(rng, { def: weapon, inst }, null, creatures);
    expect(first.broke).toBe(false);
    const second = resolveSwing(rng, { def: weapon, inst }, null, creatures);
    expect(second.broke).toBe(true);
  });

  it('blocks with a shield, costing durability', () => {
    const player = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    const shieldDef = items['bronze_never'] ?? items['shield_bronze'];
    const inst = instantiate(shieldDef!);
    player.hands.LEFT = inst;
    const viper = creatures['viper']!;
    // Walk seeds until one blocks and one lands, proving both paths.
    let blocked = 0;
    let landed = 0;
    for (let seed = 0; seed < 40; seed++) {
      const rng = new Rng(seed);
      const events: SimEvent[] = [];
      const p = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
      p.hands.LEFT = instantiate(shieldDef!);
      const dur = p.hands.LEFT.durability!;
      const out = resolveCreatureAttack(rng, p, viper, items, tuning, events);
      if (out.blocked) {
        blocked++;
        expect(p.hands.LEFT!.durability).toBe(dur - 1);
        expect(p.pulse).toBe(tuning.pulse.resting);
      } else {
        landed++;
        expect(p.pulse).toBe(tuning.pulse.resting + viper.pulseShock);
      }
    }
    expect(blocked).toBeGreaterThan(0);
    expect(landed).toBeGreaterThan(0);
  });

  it('an unblocked hit raises pulse by pulseShock', () => {
    const rng = new Rng(11);
    const events: SimEvent[] = [];
    const p = makePlayer(1, 1, 1, 0, tuning.pulse.resting);
    const spider = creatures['spider']!;
    resolveCreatureAttack(rng, p, spider, items, tuning, events);
    expect(p.pulse).toBe(tuning.pulse.resting + spider.pulseShock);
    expect(events.some((e) => e.type === 'playerHit' && !e.blocked)).toBe(true);
  });

  it('kills a creature through the full step pipeline', () => {
    const content = testContent(makeTestLevel(6, 6));
    const state = initGame(content, 31337);
    // Iron sword in right hand, rat in the cell ahead (facing E from 1,1).
    state.player.hands.RIGHT = instantiate(content.items['sword_iron']!);
    state.creatures.push(spawnCreature(content.creatures, state.uidCounter++, 'cave_rat', 1, 2, 1, -1));
    const all: SimEvent[] = [];
    // Two swings at 16 ticks each kill a 5 hp rat (min roll 3).
    const r = { verb: 'ATTACK', hand: 'RIGHT' } as const;
    all.push(...step(content, state, [r, r]));
    for (let t = 0; t < 40; t++) all.push(...step(content, state, []));
    expect(all.some((e) => e.type === 'creatureDied' && e.defId === 'cave_rat')).toBe(true);
    expect(state.creatures.every((c) => c.defId !== 'cave_rat')).toBe(true);
  });
});
