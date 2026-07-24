// Creature definitions, spawning and the per-tick AI state machine.

import type { Tuning } from '../config/tuning.ts';
import type { Rng } from './rng.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState } from './player.ts';
import {
  type LevelDef,
  type Side,
  SIDES,
  DELTA,
  bfsPath,
  bfsDistance,
  canPass,
} from './world.ts';

export type DamageMultipliers = { physical: number; fire: number; ice: number };

export interface CreatureDrop {
  itemId: string;
  chance: number;
}

export interface CreatureDef {
  id: string;
  name: string;
  tier: number;
  silhouette: string;
  health: number;
  attackDamage: [number, number];
  attackPeriodTicks: number;
  movePeriodTicks: number;
  aggression: number;
  sensesPlayerAt: number;
  damageMultipliers: DamageMultipliers;
  soundId: string;
  drops: CreatureDrop[];
  pulseShock: number;
}

export type CreatureAiState = 'idle' | 'hunting' | 'attacking' | 'fleeing';

export interface CreatureInstance {
  uid: number;
  defId: string;
  levelId: number;
  x: number;
  y: number;
  hp: number;
  state: CreatureAiState;
  moveCooldown: number;
  attackCooldown: number;
  /** Index of the spawn entry that produced this creature, for respawn caps. */
  spawnIndex: number;
}

export function validateCreatures(raw: unknown, path: string): Record<string, CreatureDef> {
  if (!Array.isArray(raw)) throw new Error(`Content error in ${path}: root must be an array`);
  const out: Record<string, CreatureDef> = {};
  raw.forEach((entry, i) => {
    const fail = (field: string, why: string): never => {
      throw new Error(`Content error in ${path} entry ${i} field "${field}": ${why}`);
    };
    const d = entry as CreatureDef;
    if (typeof d.id !== 'string' || d.id.length === 0) fail('id', 'must be a non-empty string');
    if (out[d.id]) fail('id', `duplicate id ${d.id}`);
    if (typeof d.name !== 'string') fail('name', 'must be a string');
    if (typeof d.tier !== 'number') fail('tier', 'must be a number');
    if (typeof d.silhouette !== 'string') fail('silhouette', 'must be a string');
    if (typeof d.health !== 'number' || d.health <= 0) fail('health', 'must be positive');
    if (!Array.isArray(d.attackDamage) || d.attackDamage.length !== 2)
      fail('attackDamage', 'must be [min,max]');
    for (const f of ['attackPeriodTicks', 'movePeriodTicks', 'sensesPlayerAt', 'pulseShock'] as const) {
      if (typeof d[f] !== 'number' || d[f] < 0) fail(f, 'must be a non-negative number');
    }
    if (typeof d.aggression !== 'number' || d.aggression < 0 || d.aggression > 1)
      fail('aggression', 'must be 0..1');
    const m = d.damageMultipliers;
    if (!m || typeof m.physical !== 'number' || typeof m.fire !== 'number' || typeof m.ice !== 'number')
      fail('damageMultipliers', 'must hold physical, fire, ice');
    if (typeof d.soundId !== 'string') fail('soundId', 'must be a string');
    if (!Array.isArray(d.drops)) fail('drops', 'must be an array');
    out[d.id] = d;
  });
  return out;
}

/** Relative bearing from the player to (x,y), radians; 0 = dead ahead, positive = right. */
export function bearingFromPlayer(player: PlayerState, x: number, y: number): number {
  const dx = x - player.x;
  const dy = y - player.y;
  // World angle with north = 0, clockwise positive.
  const worldAngle = Math.atan2(dx, -dy);
  const facingAngle = (player.facing * Math.PI) / 2;
  let rel = worldAngle - facingAngle;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return rel;
}

export function distanceFromPlayer(player: PlayerState, x: number, y: number): number {
  return Math.hypot(x - player.x, y - player.y);
}

interface AiContext {
  level: LevelDef;
  defs: Record<string, CreatureDef>;
  player: PlayerState;
  creatures: CreatureInstance[];
  rng: Rng;
  tuning: Tuning;
  fearTicks: number;
  events: SimEvent[];
  /** Called when a creature lands an unblocked or blocked hit. */
  resolveCreatureHit: (creature: CreatureInstance) => void;
}

function occupied(creatures: CreatureInstance[], self: CreatureInstance, x: number, y: number): boolean {
  return creatures.some((c) => c !== self && c.levelId === self.levelId && c.x === x && c.y === y && c.hp > 0);
}

function moveTo(ctx: AiContext, c: CreatureInstance, x: number, y: number): void {
  c.x = x;
  c.y = y;
  const def = ctx.defs[c.defId]!;
  c.moveCooldown = def.movePeriodTicks;
  ctx.events.push({
    type: 'footstep',
    creatureDefId: c.defId,
    soundId: def.soundId,
    distance: distanceFromPlayer(ctx.player, x, y),
    bearing: bearingFromPlayer(ctx.player, x, y),
  });
}

function wander(ctx: AiContext, c: CreatureInstance): void {
  const open: [number, number][] = [];
  for (const side of SIDES) {
    if (!canPass(ctx.level, c.x, c.y, side, { throughSecret: false })) continue;
    const [dx, dy] = DELTA[side];
    const nx = c.x + dx;
    const ny = c.y + dy;
    if (occupied(ctx.creatures, c, nx, ny)) continue;
    if (nx === ctx.player.x && ny === ctx.player.y) continue;
    open.push([nx, ny]);
  }
  if (open.length > 0 && ctx.rng.chance(ctx.tuning.creatures.idleWanderChance)) {
    const [nx, ny] = ctx.rng.pick(open);
    moveTo(ctx, c, nx, ny);
  } else {
    c.moveCooldown = ctx.defs[c.defId]!.movePeriodTicks;
  }
}

function stepTowardPlayer(ctx: AiContext, c: CreatureInstance): void {
  const path = bfsPath(
    ctx.level,
    c.x,
    c.y,
    ctx.player.x,
    ctx.player.y,
    { throughSecret: false },
    (x, y) => occupied(ctx.creatures, c, x, y),
  );
  if (path && path.length > 0) {
    const [nx, ny] = path[0]!;
    // Only one creature closes into the player's cell at a time.
    if (nx === ctx.player.x && ny === ctx.player.y && occupied(ctx.creatures, c, nx, ny)) {
      c.moveCooldown = ctx.defs[c.defId]!.movePeriodTicks;
      return;
    }
    moveTo(ctx, c, nx, ny);
  } else {
    wander(ctx, c);
  }
}

function stepAwayFromPlayer(ctx: AiContext, c: CreatureInstance): void {
  let best: [number, number] | null = null;
  let bestDist = distanceFromPlayer(ctx.player, c.x, c.y);
  for (const side of SIDES) {
    if (!canPass(ctx.level, c.x, c.y, side, { throughSecret: false })) continue;
    const [dx, dy] = DELTA[side];
    const nx = c.x + dx;
    const ny = c.y + dy;
    if (occupied(ctx.creatures, c, nx, ny)) continue;
    if (nx === ctx.player.x && ny === ctx.player.y) continue;
    const d = distanceFromPlayer(ctx.player, nx, ny);
    if (d > bestDist) {
      bestDist = d;
      best = [nx, ny];
    }
  }
  if (best) moveTo(ctx, c, best[0], best[1]);
  else c.moveCooldown = ctx.defs[c.defId]!.movePeriodTicks;
}

/** Advance one creature by one tick. */
export function tickCreature(ctx: AiContext, c: CreatureInstance): void {
  const def = ctx.defs[c.defId]!;
  if (c.hp <= 0) return;
  if (c.moveCooldown > 0) c.moveCooldown--;
  if (c.attackCooldown > 0) c.attackCooldown--;

  const inPlayerCell = c.x === ctx.player.x && c.y === ctx.player.y;
  const feared = ctx.fearTicks > 0;
  const wounded = c.hp < def.health * ctx.tuning.creatures.fleeHealthFraction;
  const shouldFlee = feared || (wounded && def.aggression < 0.5);

  // State transitions.
  if (shouldFlee) {
    c.state = 'fleeing';
  } else if (inPlayerCell) {
    c.state = 'attacking';
  } else if (c.state === 'attacking' && !inPlayerCell) {
    c.state = 'hunting';
  } else if (c.state === 'idle') {
    // Sense checks run on the creature's move cadence, behind a cheap
    // straight-line pre-filter, so idle floors stay inside the tick budget.
    if (c.moveCooldown === 0) {
      const crow = Math.abs(c.x - ctx.player.x) + Math.abs(c.y - ctx.player.y);
      if (crow <= def.sensesPlayerAt) {
        const dist = bfsDistance(
          ctx.level,
          c.x,
          c.y,
          ctx.player.x,
          ctx.player.y,
          { throughSecret: false },
          def.sensesPlayerAt,
        );
        if (dist <= def.sensesPlayerAt) c.state = 'hunting';
      }
    }
  } else if (c.state === 'fleeing' && !shouldFlee) {
    c.state = 'hunting';
  }

  // Actions.
  switch (c.state) {
    case 'attacking':
      if (c.attackCooldown === 0) {
        ctx.resolveCreatureHit(c);
        c.attackCooldown = def.attackPeriodTicks;
      }
      break;
    case 'hunting':
      if (c.moveCooldown === 0) {
        // Aggression: 1 always closes, 0 wanders even while alerted.
        if (ctx.rng.next() < def.aggression) stepTowardPlayer(ctx, c);
        else wander(ctx, c);
      }
      break;
    case 'fleeing':
      if (c.moveCooldown === 0) stepAwayFromPlayer(ctx, c);
      break;
    case 'idle':
      if (c.moveCooldown === 0) wander(ctx, c);
      break;
  }
}

export function spawnCreature(
  defs: Record<string, CreatureDef>,
  uid: number,
  defId: string,
  levelId: number,
  x: number,
  y: number,
  spawnIndex: number,
): CreatureInstance {
  const def = defs[defId];
  if (!def) throw new Error(`Unknown creature id ${defId}`);
  return {
    uid,
    defId,
    levelId,
    x,
    y,
    hp: def.health,
    state: 'idle',
    moveCooldown: def.movePeriodTicks,
    attackCooldown: def.attackPeriodTicks,
    spawnIndex,
  };
}
