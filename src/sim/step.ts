// The fixed-timestep tick function, the full game state, and its
// serialisation. Deterministic given the same seed and intent queue.

import type { Tuning } from '../config/tuning.ts';
import { Rng, type RngState } from './rng.ts';
import type { SimEvent } from './events.ts';
import type { CommandIntent } from './parser.ts';
import { intentCost, intentExertion, resolveIntent } from './commands.ts';
import { makePlayer, carriedWeight, type PlayerState } from './player.ts';
import { tickPulse, isDeadFromPulse, faintFailChance } from './pulse.ts';
import { instantiate, type ItemDef, type ItemInstance, type TorchDef } from './items.ts';
import {
  tickCreature,
  spawnCreature,
  type CreatureDef,
  type CreatureInstance,
} from './creatures.ts';
import { resolveCreatureAttack } from './combat.ts';
import { type LevelDef, SIDES, DELTA, canPass } from './world.ts';

export interface Content {
  items: Record<string, ItemDef>;
  creatures: Record<string, CreatureDef>;
  levels: Record<number, LevelDef>;
  tuning: Tuning;
}

export interface FloorItem {
  inst: ItemInstance;
  x: number;
  y: number;
}

export interface LevelRuntime {
  floorItems: FloorItem[];
  /** Per spawn entry: ticks until the next respawn attempt. */
  respawnTimers: number[];
  discoveredSecrets: string[];
}

export type GameStatus = 'playing' | 'dead' | 'won';

export interface GameState {
  schemaVersion: number;
  seed: number;
  tick: number;
  rng: Rng;
  uidCounter: number;
  player: PlayerState;
  creatures: CreatureInstance[];
  levels: Record<number, LevelRuntime>;
  queue: CommandIntent[];
  current: { intent: CommandIntent; ticksLeft: number } | null;
  fearTicks: number;
  lightBoostTicks: number;
  status: GameStatus;
  debug: { enabled: boolean; pulseFrozen: boolean };
}

/** Items the player begins with, stowed in the pack. */
const STARTING_PACK = ['torch_pine', 'sword_wood'];

function placeNear(
  level: LevelDef,
  creatures: CreatureInstance[],
  levelId: number,
  x: number,
  y: number,
): [number, number] | null {
  const taken = (cx: number, cy: number) =>
    creatures.some((c) => c.levelId === levelId && c.x === cx && c.y === cy && c.hp > 0);
  if (!taken(x, y)) return [x, y];
  // Ring search outward through passable neighbours.
  const seen = new Set<string>([`${x},${y}`]);
  let frontier: [number, number][] = [[x, y]];
  for (let ring = 0; ring < 6; ring++) {
    const next: [number, number][] = [];
    for (const [cx, cy] of frontier) {
      for (const side of SIDES) {
        if (!canPass(level, cx, cy, side, { throughSecret: false })) continue;
        const [dx, dy] = DELTA[side];
        const nx = cx + dx;
        const ny = cy + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!taken(nx, ny)) return [nx, ny];
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return null;
}

export function initGame(content: Content, seed: number, debugEnabled = false): GameState {
  const firstLevel = content.levels[1];
  if (!firstLevel) throw new Error('Content error: no level with id 1');
  const state: GameState = {
    schemaVersion: content.tuning.save.schemaVersion,
    seed,
    tick: 0,
    rng: new Rng(seed),
    uidCounter: 1,
    player: makePlayer(1, 1, 1, 1, content.tuning.pulse.resting),
    creatures: [],
    levels: {},
    queue: [],
    current: null,
    fearTicks: 0,
    lightBoostTicks: 0,
    status: 'playing',
    debug: { enabled: debugEnabled, pulseFrozen: false },
  };
  // Start where the stairs up to the surface sit, if the map has them.
  const entry = firstLevel.features.stairsUp?.[0];
  if (entry) {
    state.player.x = entry.at[0];
    state.player.y = entry.at[1];
  }
  for (const id of STARTING_PACK) {
    const def = content.items[id];
    if (def) state.player.pack.push(instantiate(def));
  }
  for (const level of Object.values(content.levels)) {
    const runtime: LevelRuntime = { floorItems: [], respawnTimers: [], discoveredSecrets: [] };
    for (const placed of level.itemsPlaced) {
      const def = content.items[placed.itemId];
      if (!def) throw new Error(`Content error: level ${level.id} places unknown item ${placed.itemId}`);
      runtime.floorItems.push({ inst: instantiate(def), x: placed.at[0], y: placed.at[1] });
    }
    level.creatureSpawns.forEach((spawn, spawnIndex) => {
      if (!content.creatures[spawn.creatureId])
        throw new Error(`Content error: level ${level.id} spawns unknown creature ${spawn.creatureId}`);
      runtime.respawnTimers.push(spawn.respawn ? spawn.respawn.afterTicks : -1);
      for (let n = 0; n < spawn.count; n++) {
        const at = placeNear(level, state.creatures, level.id, spawn.at[0], spawn.at[1]);
        if (at) {
          state.creatures.push(
            spawnCreature(content.creatures, state.uidCounter++, spawn.creatureId, level.id, at[0], at[1], spawnIndex),
          );
        }
      }
    });
    state.levels[level.id] = runtime;
  }
  return state;
}

/** The current light radius in cells; 0 with no lit torch. */
export function lightRadius(content: Content, state: GameState): number {
  let radius = 0;
  for (const hand of ['LEFT', 'RIGHT'] as const) {
    const inst = state.player.hands[hand];
    if (!inst || !inst.lit || (inst.burnLeft ?? 0) <= 0) continue;
    const def = content.items[inst.defId]!;
    if (def.kind === 'torch') radius = Math.max(radius, def.radius);
  }
  if (radius > 0 && state.lightBoostTicks > 0) radius += content.tuning.light.incantRadiusBonus;
  return radius;
}

/** The brightest line intensity the current light allows, 1..levels. */
export function lightIntensity(content: Content, state: GameState): number {
  let intensity = 0;
  for (const hand of ['LEFT', 'RIGHT'] as const) {
    const inst = state.player.hands[hand];
    if (!inst || !inst.lit || (inst.burnLeft ?? 0) <= 0) continue;
    const def = content.items[inst.defId]!;
    if (def.kind === 'torch') intensity = Math.max(intensity, (def as TorchDef).intensity);
  }
  return intensity;
}

export function flushQueue(state: GameState): void {
  state.queue = [];
}

function burnTorches(content: Content, state: GameState, events: SimEvent[]): void {
  const p = state.player;
  for (const hand of ['LEFT', 'RIGHT'] as const) {
    const inst = p.hands[hand];
    if (!inst || !inst.lit) continue;
    inst.burnLeft = (inst.burnLeft ?? 0) - 1;
    if (inst.burnLeft <= 0) {
      // A dead torch drops out of the hand as ash.
      p.hands[hand] = null;
      events.push({ type: 'torchDied' });
      events.push({ type: 'message', key: 'torch_died' });
    }
  }
  // A lit torch stowed in the pack keeps burning, unseen.
  p.pack = p.pack.filter((inst) => {
    if (!inst.lit) return true;
    inst.burnLeft = (inst.burnLeft ?? 0) - 1;
    if (inst.burnLeft <= 0) {
      events.push({ type: 'message', key: 'torch_died_pack' });
      return false;
    }
    return true;
  });
}

function tickRespawns(content: Content, state: GameState, events: SimEvent[]): void {
  const levelId = state.player.levelId;
  const level = content.levels[levelId]!;
  const runtime = state.levels[levelId]!;
  level.creatureSpawns.forEach((spawn, spawnIndex) => {
    if (!spawn.respawn) return;
    const alive = state.creatures.filter(
      (c) => c.levelId === levelId && c.spawnIndex === spawnIndex && c.hp > 0,
    ).length;
    if (alive >= spawn.respawn.max) {
      runtime.respawnTimers[spawnIndex] = spawn.respawn.afterTicks;
      return;
    }
    const t = (runtime.respawnTimers[spawnIndex] ?? spawn.respawn.afterTicks) - 1;
    if (t <= 0) {
      const at = placeNear(level, state.creatures, levelId, spawn.at[0], spawn.at[1]);
      const blockedByPlayer = at && at[0] === state.player.x && at[1] === state.player.y;
      if (at && !blockedByPlayer) {
        state.creatures.push(
          spawnCreature(content.creatures, state.uidCounter++, spawn.creatureId, levelId, at[0], at[1], spawnIndex),
        );
        runtime.respawnTimers[spawnIndex] = spawn.respawn.afterTicks;
      } else {
        runtime.respawnTimers[spawnIndex] = 1; // retry next tick
      }
    } else {
      runtime.respawnTimers[spawnIndex] = t;
    }
  });
}

/**
 * Advance the simulation one tick. `submitted` holds intents newly
 * queued by the player this tick (already parsed). Returns the events
 * the tick produced; mutates `state` in place.
 */
export function step(content: Content, state: GameState, submitted: readonly CommandIntent[]): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.status !== 'playing') return events;

  state.tick++;
  state.queue.push(...submitted);

  // Commands: start the next one when idle; resolve when the cost drains.
  if (!state.current && state.queue.length > 0) {
    const intent = state.queue.shift()!;
    const cost = intentCost(content, state, intent);
    state.player.exertion += intentExertion(content, state, intent);
    state.current = { intent, ticksLeft: cost };
  }
  if (state.current) {
    if (state.current.ticksLeft > 0) state.current.ticksLeft--;
    if (state.current.ticksLeft <= 0) {
      const { intent } = state.current;
      state.current = null;
      const failChance = faintFailChance(state.player, content.tuning);
      const isMeta = intent.verb === 'ZSAVE' || intent.verb === 'ZLOAD' || intent.verb === 'DEBUG';
      if (!isMeta && failChance > 0 && state.rng.chance(failChance)) {
        events.push({ type: 'message', key: 'faint_fumble' });
      } else {
        resolveIntent(content, state, intent, events);
      }
    }
  }

  if (state.status !== 'playing') return events;

  // Creatures on the player's floor only; other floors sleep.
  const level = content.levels[state.player.levelId]!;
  const onFloor = state.creatures.filter((c) => c.levelId === state.player.levelId);
  for (const c of onFloor) {
    tickCreature(
      {
        level,
        defs: content.creatures,
        player: state.player,
        creatures: state.creatures,
        rng: state.rng,
        tuning: content.tuning,
        fearTicks: state.fearTicks,
        events,
        resolveCreatureHit: (creature) => {
          const cdef = content.creatures[creature.defId]!;
          resolveCreatureAttack(state.rng, state.player, cdef, content.items, content.tuning, events);
        },
      },
      c,
    );
  }

  tickRespawns(content, state, events);
  burnTorches(content, state, events);

  if (!state.debug.pulseFrozen) {
    tickPulse(state.player, carriedWeight(state.player, content.items), content.tuning);
  }
  if (isDeadFromPulse(state.player, content.tuning)) {
    state.player.alive = false;
    state.status = 'dead';
    events.push({ type: 'death' });
    events.push({ type: 'message', key: 'death_line' });
  }

  if (state.fearTicks > 0) state.fearTicks--;
  if (state.lightBoostTicks > 0) state.lightBoostTicks--;

  return events;
}

// ---------------------------------------------------------------------------
// Serialisation

export interface SavedGame {
  schemaVersion: number;
  seed: number;
  tick: number;
  rng: RngState;
  uidCounter: number;
  player: PlayerState;
  creatures: CreatureInstance[];
  levels: Record<number, LevelRuntime>;
  queue: CommandIntent[];
  current: { intent: CommandIntent; ticksLeft: number } | null;
  fearTicks: number;
  lightBoostTicks: number;
  status: GameStatus;
}

export function serializeGame(state: GameState): SavedGame {
  const { rng, debug, ...rest } = state;
  return JSON.parse(JSON.stringify({ ...rest, rng: rng.state() })) as SavedGame;
}

export function deserializeGame(content: Content, saved: SavedGame, debugEnabled = false): GameState {
  if (saved.schemaVersion !== content.tuning.save.schemaVersion) {
    throw new Error(
      `Save schema version ${saved.schemaVersion} does not match build version ${content.tuning.save.schemaVersion}`,
    );
  }
  const copy = JSON.parse(JSON.stringify(saved)) as SavedGame;
  return {
    ...copy,
    rng: Rng.fromState(copy.rng),
    debug: { enabled: debugEnabled, pulseFrozen: false },
  };
}

/** Stable FNV-1a hash of the serialised state, for replay tests. */
export function hashGame(state: GameState): string {
  const saved = serializeGame(state);
  const json = stableStringify(saved);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
