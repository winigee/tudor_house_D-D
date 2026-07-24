// Grid model: cells, walls, doors, stairs, occupancy queries,
// line of sight and breadth-first pathfinding.

export type Facing = 0 | 1 | 2 | 3; // N E S W
export type Side = 'N' | 'E' | 'S' | 'W';

export const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
export const SIDE_BIT: Record<Side, number> = { N: 1, E: 2, S: 4, W: 8 };
export const FACING_SIDE: readonly Side[] = ['N', 'E', 'S', 'W'];
export const DELTA: Record<Side, [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};
export const OPPOSITE: Record<Side, Side> = { N: 'S', E: 'W', S: 'N', W: 'E' };

export interface CellDef {
  walls: number;
  feature: string;
}

export interface DoorDef {
  at: [number, number];
  side: Side;
  secret: boolean;
}

export interface StairsDef {
  at: [number, number];
  to: number;
}

export interface ItemPlacement {
  itemId: string;
  at: [number, number];
}

export interface CreatureSpawnDef {
  creatureId: string;
  at: [number, number];
  count: number;
  respawn?: { afterTicks: number; max: number };
}

export interface LevelDef {
  id: number;
  size: { w: number; h: number };
  cells: CellDef[];
  features: {
    door?: DoorDef[];
    stairsDown?: StairsDef[];
    stairsUp?: StairsDef[];
  };
  itemsPlaced: ItemPlacement[];
  creatureSpawns: CreatureSpawnDef[];
  ambientSeed: number;
}

export function validateLevel(raw: unknown, path: string): LevelDef {
  const fail = (field: string, why: string): never => {
    throw new Error(`Content error in ${path} field "${field}": ${why}`);
  };
  const l = raw as LevelDef;
  if (typeof l.id !== 'number') fail('id', 'must be a number');
  if (!l.size || typeof l.size.w !== 'number' || typeof l.size.h !== 'number')
    fail('size', 'must be {w,h}');
  if (!Array.isArray(l.cells) || l.cells.length !== l.size.w * l.size.h)
    fail('cells', `must hold ${l.size.w * l.size.h} entries, got ${Array.isArray(l.cells) ? l.cells.length : 'none'}`);
  for (let i = 0; i < l.cells.length; i++) {
    const c = l.cells[i]!;
    if (typeof c.walls !== 'number' || c.walls < 0 || c.walls > 15)
      fail(`cells[${i}].walls`, 'must be a 4-bit mask');
  }
  // Wall symmetry: the wall between two cells must appear on both sides.
  for (let y = 0; y < l.size.h; y++) {
    for (let x = 0; x < l.size.w; x++) {
      const c = l.cells[y * l.size.w + x]!;
      for (const side of SIDES) {
        const [dx, dy] = DELTA[side];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= l.size.w || ny >= l.size.h) continue;
        const n = l.cells[ny * l.size.w + nx]!;
        const here = (c.walls & SIDE_BIT[side]) !== 0;
        const there = (n.walls & SIDE_BIT[OPPOSITE[side]]) !== 0;
        if (here !== there)
          fail(`cells[${y * l.size.w + x}].walls`, `wall ${side} at ${x},${y} not mirrored by neighbour`);
      }
    }
  }
  if (!l.features) fail('features', 'missing');
  for (const d of l.features.door ?? []) {
    if (!hasWall(l, d.at[0], d.at[1], d.side))
      fail('features.door', `door at ${d.at[0]},${d.at[1]} side ${d.side} has no wall`);
  }
  if (!Array.isArray(l.itemsPlaced)) fail('itemsPlaced', 'must be an array');
  if (!Array.isArray(l.creatureSpawns)) fail('creatureSpawns', 'must be an array');
  if (typeof l.ambientSeed !== 'number') fail('ambientSeed', 'must be a number');
  return l;
}

export function inBounds(level: LevelDef, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.size.w && y < level.size.h;
}

export function cellAt(level: LevelDef, x: number, y: number): CellDef {
  return level.cells[y * level.size.w + x]!;
}

export function hasWall(level: LevelDef, x: number, y: number, side: Side): boolean {
  if (!inBounds(level, x, y)) return true;
  return (cellAt(level, x, y).walls & SIDE_BIT[side]) !== 0;
}

export function doorAt(level: LevelDef, x: number, y: number, side: Side): DoorDef | undefined {
  for (const d of level.features.door ?? []) {
    if (d.at[0] === x && d.at[1] === y && d.side === side) return d;
    // The same door seen from the neighbouring cell.
    const [dx, dy] = DELTA[d.side];
    if (d.at[0] + dx === x && d.at[1] + dy === y && OPPOSITE[d.side] === side) return d;
  }
  return undefined;
}

export interface PassOptions {
  /** True for the player, who may pass secret doors. */
  throughSecret: boolean;
}

interface PassMasks {
  /** Bit per side (N=1 E=2 S=4 W=8): passable for creatures. */
  creature: Uint8Array;
  /** Passable for the player (secret doors open to them). */
  player: Uint8Array;
}

// LevelDef content is static after load, so passability caches per level.
const passCache = new WeakMap<LevelDef, PassMasks>();

function buildPassMasks(level: LevelDef): PassMasks {
  const w = level.size.w;
  const h = level.size.h;
  const creature = new Uint8Array(w * h);
  const player = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let cm = 0;
      let pm = 0;
      for (const side of SIDES) {
        const [dx, dy] = DELTA[side];
        if (!inBounds(level, x + dx, y + dy)) continue;
        const bit = SIDE_BIT[side];
        if (!hasWall(level, x, y, side)) {
          cm |= bit;
          pm |= bit;
          continue;
        }
        const door = doorAt(level, x, y, side);
        if (!door) continue;
        if (door.secret) pm |= bit;
        else {
          cm |= bit;
          pm |= bit;
        }
      }
      creature[y * w + x] = cm;
      player[y * w + x] = pm;
    }
  }
  return { creature, player };
}

/** Can something in (x,y) pass through the given side? */
export function canPass(level: LevelDef, x: number, y: number, side: Side, opts: PassOptions): boolean {
  if (!inBounds(level, x, y)) return false;
  let masks = passCache.get(level);
  if (!masks) {
    masks = buildPassMasks(level);
    passCache.set(level, masks);
  }
  const mask = opts.throughSecret ? masks.player : masks.creature;
  return (mask[y * level.size.w + x]! & SIDE_BIT[side]) !== 0;
}

export function stairsAt(level: LevelDef, x: number, y: number, dir: 'UP' | 'DOWN'): StairsDef | undefined {
  const list = dir === 'UP' ? level.features.stairsUp : level.features.stairsDown;
  return (list ?? []).find((s) => s.at[0] === x && s.at[1] === y);
}

/**
 * Straight-line visibility along one axis: true when every wall between
 * the two cells is open or a plain doorway. Used for creature drawing
 * and ring bolts; the view is corridor-based so only aligned cells count.
 */
export function lineOfSight(
  level: LevelDef,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  if (fromX === toX && fromY === toY) return true;
  if (fromX !== toX && fromY !== toY) return false;
  let side: Side;
  if (fromX === toX) side = toY > fromY ? 'S' : 'N';
  else side = toX > fromX ? 'E' : 'W';
  const [dx, dy] = DELTA[side];
  let x = fromX;
  let y = fromY;
  while (x !== toX || y !== toY) {
    if (!canPass(level, x, y, side, { throughSecret: false })) return false;
    x += dx;
    y += dy;
  }
  return true;
}

/**
 * Breadth-first path from (sx,sy) to (tx,ty). Returns the list of steps
 * (excluding the start, including the target) or null when unreachable.
 * `blocked` marks cells the walker will not enter (other creatures).
 */
export function bfsPath(
  level: LevelDef,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  opts: PassOptions,
  blocked?: (x: number, y: number) => boolean,
  maxDepth = Infinity,
): [number, number][] | null {
  if (sx === tx && sy === ty) return [];
  const w = level.size.w;
  const h = level.size.h;
  const prev = new Int32Array(w * h).fill(-2);
  prev[sy * w + sx] = -1;
  let frontier: number[] = [sy * w + sx];
  let depth = 0;
  while (frontier.length > 0 && depth++ < maxDepth) {
    const next: number[] = [];
    for (const idx of frontier) {
      const x = idx % w;
      const y = Math.floor(idx / w);
      for (const side of SIDES) {
        if (!canPass(level, x, y, side, opts)) continue;
        const [dx, dy] = DELTA[side];
        const nx = x + dx;
        const ny = y + dy;
        const nidx = ny * w + nx;
        if (prev[nidx] !== -2) continue;
        const isTarget = nx === tx && ny === ty;
        if (!isTarget && blocked && blocked(nx, ny)) continue;
        prev[nidx] = idx;
        if (isTarget) {
          const path: [number, number][] = [];
          let cur = nidx;
          while (cur !== sy * w + sx) {
            path.push([cur % w, Math.floor(cur / w)]);
            cur = prev[cur]!;
          }
          path.reverse();
          return path;
        }
        next.push(nidx);
      }
    }
    frontier = next;
  }
  return null;
}

/** BFS distance in cells, or Infinity when unreachable or beyond maxDepth. */
export function bfsDistance(
  level: LevelDef,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  opts: PassOptions,
  maxDepth = Infinity,
): number {
  const path = bfsPath(level, sx, sy, tx, ty, opts, undefined, maxDepth);
  return path === null ? Infinity : path.length;
}
