// Hit resolution: player swings, ring bolts, creature attacks,
// shield blocks and durability decay.

import type { Tuning } from '../config/tuning.ts';
import type { Rng } from './rng.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState, Hand } from './player.ts';
import type { ItemDef, ItemInstance, DamageType, WeaponDef, ShieldDef } from './items.ts';
import type { CreatureDef, CreatureInstance } from './creatures.ts';
import { applyShock } from './pulse.ts';

export function rollDamage(rng: Rng, range: [number, number]): number {
  return rng.int(range[0], range[1]);
}

export function damageAgainst(def: CreatureDef, amount: number, type: DamageType): number {
  return Math.round(amount * def.damageMultipliers[type]);
}

export interface SwingOutcome {
  hit: boolean;
  killed: boolean;
  broke: boolean;
  target: CreatureInstance | null;
  damage: number;
}

/**
 * Resolve a weapon swing against a target creature (already chosen by the
 * caller: the cell ahead, or the player's own cell when a creature has
 * closed). Decays weapon durability by one per swing.
 */
export function resolveSwing(
  rng: Rng,
  weapon: { def: WeaponDef; inst: ItemInstance },
  target: CreatureInstance | null,
  creatureDefs: Record<string, CreatureDef>,
): SwingOutcome {
  const out: SwingOutcome = { hit: false, killed: false, broke: false, target, damage: 0 };
  if (target) {
    const cdef = creatureDefs[target.defId]!;
    const raw = rollDamage(rng, weapon.def.damage);
    out.damage = damageAgainst(cdef, raw, weapon.def.damageType);
    target.hp -= out.damage;
    out.hit = true;
    if (target.hp <= 0) out.killed = true;
  }
  const dur = (weapon.inst.durability ?? 1) - 1;
  weapon.inst.durability = dur;
  if (dur <= 0) out.broke = true;
  return out;
}

export interface CreatureHitOutcome {
  blocked: boolean;
  shieldBroke: boolean;
  shock: number;
}

/**
 * Resolve a creature landing an attack on the player. A held shield
 * blocks with its `block` probability, costing shield durability.
 * An unblocked hit adds pulseShock to the pulse and the damage roll
 * (scaled) to exertion.
 */
export function resolveCreatureAttack(
  rng: Rng,
  player: PlayerState,
  creatureDef: CreatureDef,
  itemDefs: Record<string, ItemDef>,
  tuning: Tuning,
  events: SimEvent[],
): CreatureHitOutcome {
  // Find the best held shield.
  let shield: { inst: ItemInstance; def: ShieldDef; hand: Hand } | null = null;
  for (const hand of ['LEFT', 'RIGHT'] as const) {
    const inst = player.hands[hand];
    if (!inst) continue;
    const def = itemDefs[inst.defId]!;
    if (def.kind === 'shield' && (shield === null || def.block > shield.def.block)) {
      shield = { inst, def, hand };
    }
  }
  if (shield && rng.chance(shield.def.block)) {
    shield.inst.durability = (shield.inst.durability ?? 1) - 1;
    let shieldBroke = false;
    if (shield.inst.durability <= 0) {
      player.hands[shield.hand] = null;
      shieldBroke = true;
      events.push({ type: 'itemBroke', kind: 'shield' });
      events.push({ type: 'message', key: 'shield_broke' });
    }
    events.push({ type: 'playerHit', shock: 0, blocked: true });
    events.push({ type: 'message', key: 'attack_blocked', params: { creature: creatureDef.name } });
    return { blocked: true, shieldBroke, shock: 0 };
  }
  const dmg = rollDamage(rng, creatureDef.attackDamage);
  applyShock(player, creatureDef.pulseShock);
  player.exertion += dmg * tuning.pulse.hitExertionFactor;
  events.push({ type: 'playerHit', shock: creatureDef.pulseShock, blocked: false });
  events.push({ type: 'message', key: 'attack_landed', params: { creature: creatureDef.name } });
  return { blocked: false, shieldBroke: false, shock: creatureDef.pulseShock };
}
