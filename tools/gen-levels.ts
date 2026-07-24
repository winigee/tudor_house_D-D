// Deterministic dungeon floor generator. Seeded generation with
// hand-placed feature tables (see DECISIONS.md). Writes
// src/data/levels/<n>.json; run with `npm run build:levels`.
// Committed output is the content of record; regenerate only on purpose.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/sim/rng.ts';
import {
  SIDES,
  SIDE_BIT,
  DELTA,
  OPPOSITE,
  type Side,
  type LevelDef,
  type DoorDef,
  validateLevel,
} from '../src/sim/world.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'data', 'levels');

const W = 32;
const H = 32;
const MASTER_SEED = 0xda660;

interface FloorSpec {
  id: number;
  loopFraction: number;
  doors: number;
  secretDoors: number;
  items: string[];
  spawns: { creatureId: string; count: number; respawn?: { afterTicks: number; max: number } }[];
}

const FLOORS: FloorSpec[] = [
  {
    id: 1,
    loopFraction: 0.1,
    doors: 12,
    secretDoors: 2,
    items: ['torch_pine', 'torch_pine', 'dagger', 'shield_leather', 'flask_heal'],
    spawns: [
      { creatureId: 'spider', count: 2, respawn: { afterTicks: 1800, max: 3 } },
      { creatureId: 'cave_rat', count: 3, respawn: { afterTicks: 1200, max: 4 } },
    ],
  },
  {
    id: 2,
    loopFraction: 0.09,
    doors: 14,
    secretDoors: 3,
    items: ['torch_bronze', 'torch_bronze', 'sword_iron', 'flask_heal', 'flask_vigor', 'scroll_light'],
    spawns: [
      { creatureId: 'spider', count: 2, respawn: { afterTicks: 1800, max: 3 } },
      { creatureId: 'viper', count: 2, respawn: { afterTicks: 2400, max: 3 } },
      { creatureId: 'gray_ooze', count: 1, respawn: { afterTicks: 3000, max: 2 } },
    ],
  },
  {
    id: 3,
    loopFraction: 0.08,
    doors: 16,
    secretDoors: 4,
    items: ['torch_bronze', 'torch_lunar', 'shield_bronze', 'ring_seeing', 'flask_heal', 'flask_heal', 'scroll_fear'],
    spawns: [
      { creatureId: 'viper', count: 2, respawn: { afterTicks: 2400, max: 3 } },
      { creatureId: 'hollow_knight', count: 2, respawn: { afterTicks: 3000, max: 2 } },
      { creatureId: 'barrow_shade', count: 2, respawn: { afterTicks: 2700, max: 3 } },
    ],
  },
  {
    id: 4,
    loopFraction: 0.07,
    doors: 18,
    secretDoors: 5,
    items: ['torch_lunar', 'torch_solar', 'ring_fire', 'flask_heal', 'flask_heal', 'scroll_calm', 'shield_mithral'],
    spawns: [
      { creatureId: 'hollow_knight', count: 2, respawn: { afterTicks: 3000, max: 2 } },
      { creatureId: 'stone_giant', count: 1, respawn: { afterTicks: 3600, max: 2 } },
      { creatureId: 'pale_stalker', count: 2, respawn: { afterTicks: 3200, max: 2 } },
      { creatureId: 'wizard_image', count: 1, respawn: { afterTicks: 3600, max: 1 } },
    ],
  },
  {
    id: 5,
    loopFraction: 0.06,
    doors: 20,
    secretDoors: 6,
    items: ['torch_solar', 'ring_ice', 'flask_heal', 'flask_heal', 'sword_rune'],
    spawns: [
      { creatureId: 'pale_stalker', count: 2, respawn: { afterTicks: 3200, max: 2 } },
      { creatureId: 'stone_giant', count: 1, respawn: { afterTicks: 3600, max: 1 } },
      { creatureId: 'wizard_image', count: 2, respawn: { afterTicks: 3600, max: 2 } },
      { creatureId: 'wizard', count: 1 },
    ],
  },
];

function idx(x: number, y: number): number {
  return y * W + x;
}

function carveMaze(rng: Rng): number[] {
  const walls = new Array<number>(W * H).fill(15);
  const visited = new Array<boolean>(W * H).fill(false);
  const stack: [number, number][] = [[1, 1]];
  visited[idx(1, 1)] = true;
  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1]!;
    const options: Side[] = [];
    for (const side of SIDES) {
      const [dx, dy] = DELTA[side];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!visited[idx(nx, ny)]) options.push(side);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const side = rng.pick(options);
    const [dx, dy] = DELTA[side];
    const nx = x + dx;
    const ny = y + dy;
    walls[idx(x, y)]! &= ~SIDE_BIT[side];
    walls[idx(nx, ny)]! &= ~SIDE_BIT[OPPOSITE[side]];
    visited[idx(nx, ny)] = true;
    stack.push([nx, ny]);
  }
  return walls;
}

function addLoops(rng: Rng, walls: number[], fraction: number): void {
  // Knock openings through a fraction of the internal walls so the maze
  // is not a single spanning tree; loops give creatures flanking routes.
  const candidates: [number, number, Side][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const side of ['E', 'S'] as const) {
        const [dx, dy] = DELTA[side];
        if (x + dx >= W || y + dy >= H) continue;
        if (walls[idx(x, y)]! & SIDE_BIT[side]) candidates.push([x, y, side]);
      }
    }
  }
  const toOpen = Math.floor(candidates.length * fraction);
  for (let n = 0; n < toOpen; n++) {
    const [x, y, side] = candidates[rng.int(0, candidates.length - 1)]!;
    const [dx, dy] = DELTA[side];
    walls[idx(x, y)]! &= ~SIDE_BIT[side];
    walls[idx(x + dx, y + dy)]! &= ~SIDE_BIT[OPPOSITE[side]];
  }
}

function openSides(walls: number[], x: number, y: number): Side[] {
  return SIDES.filter((s) => {
    const [dx, dy] = DELTA[s];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    return (walls[idx(x, y)]! & SIDE_BIT[s]) === 0;
  });
}

function placeDoors(rng: Rng, walls: number[], count: number, secretCount: number): DoorDef[] {
  const doors: DoorDef[] = [];
  const used = new Set<string>();
  const doorKey = (x: number, y: number, side: Side): string => {
    const [dx, dy] = DELTA[side];
    const nx = x + dx;
    const ny = y + dy;
    return side === 'E' || side === 'S' ? `${x},${y},${side}` : `${nx},${ny},${OPPOSITE[side]}`;
  };
  // Ordinary doors close over carved openings: the wall bit returns and
  // the door feature keeps the gap passable.
  let guard = 0;
  while (doors.length < count && guard++ < 5000) {
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    const open = openSides(walls, x, y);
    if (open.length === 0) continue;
    const side = rng.pick(open);
    const key = doorKey(x, y, side);
    if (used.has(key)) continue;
    used.add(key);
    const [dx, dy] = DELTA[side];
    walls[idx(x, y)]! |= SIDE_BIT[side];
    walls[idx(x + dx, y + dy)]! |= SIDE_BIT[OPPOSITE[side]];
    doors.push({ at: [x, y], side, secret: false });
  }
  // Secret doors pierce walls that are still solid.
  guard = 0;
  let placedSecret = 0;
  while (placedSecret < secretCount && guard++ < 5000) {
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    const side = rng.pick(SIDES);
    const [dx, dy] = DELTA[side];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
    if ((walls[idx(x, y)]! & SIDE_BIT[side]) === 0) continue;
    const key = doorKey(x, y, side);
    if (used.has(key)) continue;
    used.add(key);
    doors.push({ at: [x, y], side, secret: true });
    placedSecret++;
  }
  return doors;
}

function farthestCell(rng: Rng, fromX: number, fromY: number, taken: Set<string>): [number, number] {
  // Sample candidates and keep the farthest untaken one.
  let best: [number, number] = [W - 2, H - 2];
  let bestDist = -1;
  for (let n = 0; n < 60; n++) {
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    if (taken.has(`${x},${y}`)) continue;
    const d = Math.abs(x - fromX) + Math.abs(y - fromY);
    if (d > bestDist) {
      bestDist = d;
      best = [x, y];
    }
  }
  return best;
}

function randomFreeCell(rng: Rng, taken: Set<string>): [number, number] {
  for (let n = 0; n < 500; n++) {
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    if (!taken.has(`${x},${y}`)) return [x, y];
  }
  throw new Error('no free cell found');
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  let stairsUpAt: [number, number] = [1, 1];
  for (const spec of FLOORS) {
    const rng = new Rng(MASTER_SEED + spec.id * 7919);
    const walls = carveMaze(rng);
    addLoops(rng, walls, spec.loopFraction);
    const doors = placeDoors(rng, walls, spec.doors, spec.secretDoors);

    const taken = new Set<string>();
    taken.add(`${stairsUpAt[0]},${stairsUpAt[1]}`);
    const stairsUp = [{ at: stairsUpAt, to: spec.id - 1 }];
    const features: LevelDef['features'] = { door: doors, stairsUp };
    let nextStairsUp: [number, number] | null = null;
    if (spec.id < FLOORS.length) {
      const down = farthestCell(rng, stairsUpAt[0], stairsUpAt[1], taken);
      taken.add(`${down[0]},${down[1]}`);
      features.stairsDown = [{ at: down, to: spec.id + 1 }];
      nextStairsUp = down;
    }

    const cells = walls.map((w) => ({ walls: w, feature: 'none' }));
    for (const s of features.stairsUp ?? []) cells[idx(s.at[0], s.at[1])]!.feature = 'stairsUp';
    for (const s of features.stairsDown ?? []) cells[idx(s.at[0], s.at[1])]!.feature = 'stairsDown';

    const itemsPlaced = spec.items.map((itemId) => {
      const at = randomFreeCell(rng, taken);
      taken.add(`${at[0]},${at[1]}`);
      return { itemId, at };
    });

    const creatureSpawns = spec.spawns.map((s) => {
      // Spawn points keep away from the stairs the player arrives on.
      let at: [number, number];
      let guard = 0;
      do {
        at = randomFreeCell(rng, taken);
      } while (Math.abs(at[0] - stairsUpAt[0]) + Math.abs(at[1] - stairsUpAt[1]) < 6 && guard++ < 200);
      taken.add(`${at[0]},${at[1]}`);
      return { creatureId: s.creatureId, at, count: s.count, ...(s.respawn ? { respawn: s.respawn } : {}) };
    });

    const level: LevelDef = {
      id: spec.id,
      size: { w: W, h: H },
      cells,
      features,
      itemsPlaced,
      creatureSpawns,
      ambientSeed: rng.int(0, 0xffff),
    };
    validateLevel(level, `generated level ${spec.id}`);
    const out = join(OUT_DIR, `${spec.id}.json`);
    writeFileSync(out, JSON.stringify(level));
    console.log(`wrote ${out} (${doors.length} doors)`);
    if (nextStairsUp) stairsUpAt = nextStairsUp;
  }
}

main();
