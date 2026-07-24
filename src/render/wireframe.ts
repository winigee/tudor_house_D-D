// Line drawing: build 3D segments from the visible cells, clip against
// the near plane, project, and stroke with dash patterns for light
// falloff. Also draws floor item icons as small wireframe shapes.

import { tuning } from '../config/tuning.ts';
import type { Content, GameState } from '../sim/step.ts';
import {
  type LevelDef,
  type Side,
  SIDES,
  SIDE_BIT,
  DELTA,
  cellAt,
  doorAt,
  hasWall,
  inBounds,
} from '../sim/world.ts';
import type { ItemKind } from '../sim/items.ts';
import { type Camera, toCameraSpace, projectCameraSpace } from './camera.ts';

export interface Segment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** Midpoint distance from the player, cells, for falloff. */
  dist: number;
}

/** Cells the player can currently see, by flood fill through open sides. */
export function visibleCells(level: LevelDef, px: number, py: number, radius: number): Set<number> {
  const w = level.size.w;
  const out = new Set<number>([py * w + px]);
  if (radius <= 0) return out;
  let frontier: [number, number][] = [[px, py]];
  for (let depth = 0; depth < radius; depth++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const side of SIDES) {
        // Sight passes only open sides: doors and secret walls block it.
        if (hasWall(level, x, y, side)) continue;
        const [dx, dy] = DELTA[side];
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(level, nx, ny)) continue;
        const idx = ny * w + nx;
        if (out.has(idx)) continue;
        if (Math.abs(nx - px) > radius || Math.abs(ny - py) > radius) continue;
        out.add(idx);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return out;
}

const WALL_H = tuning.render.wallHeight;

function wallKey(x: number, y: number, side: Side): string {
  const [dx, dy] = DELTA[side];
  return side === 'S' || side === 'E' ? `${x},${y},${side}` : `${x + dx},${y + dy},${side === 'N' ? 'S' : 'E'}`;
}

function pushRect(
  segs: Segment[],
  dist: number,
  corners: [number, number, number][],
): void {
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    segs.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], dist });
  }
}

/** The four corners of the wall plane on `side` of cell (x,y). */
function wallCorners(x: number, y: number, side: Side): [number, number, number][] {
  switch (side) {
    case 'N':
      return [
        [x, 0, y],
        [x + 1, 0, y],
        [x + 1, WALL_H, y],
        [x, WALL_H, y],
      ];
    case 'S':
      return [
        [x, 0, y + 1],
        [x + 1, 0, y + 1],
        [x + 1, WALL_H, y + 1],
        [x, WALL_H, y + 1],
      ];
    case 'W':
      return [
        [x, 0, y],
        [x, 0, y + 1],
        [x, WALL_H, y + 1],
        [x, WALL_H, y],
      ];
    case 'E':
      return [
        [x + 1, 0, y],
        [x + 1, 0, y + 1],
        [x + 1, WALL_H, y + 1],
        [x + 1, WALL_H, y],
      ];
  }
}

/** Door frame inside a wall plane: two jambs and a lintel. */
function doorFrame(x: number, y: number, side: Side): Segment[] {
  const hw = tuning.render.doorHalfWidth;
  const dh = tuning.render.doorHeight;
  const cx = x + 0.5;
  const cy = y + 0.5;
  const segs: Segment[] = [];
  const push = (ax: number, az: number, bx: number, bz: number) => {
    segs.push({ ax, ay: 0, az, bx, by: dh, bz, dist: 0 });
  };
  if (side === 'N' || side === 'S') {
    const z = side === 'N' ? y : y + 1;
    push(cx - hw, z, cx - hw, z);
    push(cx + hw, z, cx + hw, z);
    segs.push({ ax: cx - hw, ay: dh, az: z, bx: cx + hw, by: dh, bz: z, dist: 0 });
  } else {
    const wx = side === 'W' ? x : x + 1;
    push(wx, cy - hw, wx, cy - hw);
    push(wx, cy + hw, wx, cy + hw);
    segs.push({ ax: wx, ay: dh, az: cy - hw, bx: wx, by: dh, bz: cy + hw, dist: 0 });
  }
  return segs;
}

/** Simple wireframe for stairs going down (a pit with receding steps). */
function stairsDownGeometry(x: number, y: number): Segment[] {
  const segs: Segment[] = [];
  const inset = 0.18;
  const x0 = x + inset;
  const x1 = x + 1 - inset;
  const z0 = y + inset;
  const z1 = y + 1 - inset;
  pushRect(segs, 0, [
    [x0, 0, z0],
    [x1, 0, z0],
    [x1, 0, z1],
    [x0, 0, z1],
  ]);
  for (let i = 1; i <= 3; i++) {
    const f = i / 4;
    const zx = z0 + (z1 - z0) * f;
    segs.push({ ax: x0 + f * 0.15, ay: -f * 0.4, az: zx, bx: x1 - f * 0.15, by: -f * 0.4, bz: zx, dist: 0 });
  }
  return segs;
}

/** A ladder rising through the ceiling for stairs up. */
function stairsUpGeometry(x: number, y: number): Segment[] {
  const segs: Segment[] = [];
  const cx = x + 0.5;
  const z0 = y + 0.35;
  const railOff = 0.18;
  for (const off of [-railOff, railOff]) {
    segs.push({ ax: cx + off, ay: 0, az: z0, bx: cx + off, by: WALL_H, bz: z0, dist: 0 });
  }
  for (let i = 1; i <= 4; i++) {
    const h = (i / 5) * WALL_H;
    segs.push({ ax: cx - railOff, ay: h, az: z0, bx: cx + railOff, by: h, bz: z0, dist: 0 });
  }
  return segs;
}

/** Small wireframe icons for items lying on the floor. */
function itemIconGeometry(kind: ItemKind, x: number, y: number, phase: number): Segment[] {
  const s = tuning.render.itemIconSize;
  const cx = x + 0.5 + Math.sin(phase) * 0.08;
  const cz = y + 0.5 + Math.cos(phase * 0.7) * 0.08;
  const base = 0.06;
  const segs: Segment[] = [];
  const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
    segs.push({ ax, ay, az, bx, by, bz, dist: 0 });
  switch (kind) {
    case 'weapon':
      seg(cx, base, cz - s / 2, cx, base + s, cz - s / 2 + s);
      seg(cx - s / 3, base + s / 3, cz - s / 2 + s / 3 + s / 6, cx + s / 3, base + s / 3, cz - s / 2 + s / 3 - s / 6);
      break;
    case 'torch':
      seg(cx, base, cz, cx, base + s, cz);
      seg(cx - s / 4, base + s, cz, cx + s / 4, base + s * 1.3, cz);
      seg(cx + s / 4, base + s * 1.3, cz, cx - s / 6, base + s * 1.5, cz);
      break;
    case 'ring': {
      const r = s / 3;
      const pts: [number, number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, base + s / 3 + Math.sin(a) * r, cz]);
      }
      pushRect(segs, 0, pts);
      break;
    }
    case 'flask':
      seg(cx - s / 4, base, cz, cx + s / 4, base, cz);
      seg(cx + s / 4, base, cz, cx + s / 8, base + s * 0.7, cz);
      seg(cx + s / 8, base + s * 0.7, cz, cx + s / 8, base + s, cz);
      seg(cx - s / 8, base + s * 0.7, cz, cx - s / 8, base + s, cz);
      seg(cx - s / 4, base, cz, cx - s / 8, base + s * 0.7, cz);
      seg(cx - s / 8, base + s, cz, cx + s / 8, base + s, cz);
      break;
    case 'scroll':
      seg(cx - s / 2, base + s / 4, cz, cx + s / 2, base + s / 4, cz);
      seg(cx - s / 2, base + s * 0.75, cz, cx + s / 2, base + s * 0.75, cz);
      seg(cx - s / 2, base + s / 4, cz, cx - s / 2, base + s * 0.75, cz);
      seg(cx + s / 2, base + s / 4, cz, cx + s / 2, base + s * 0.75, cz);
      break;
    case 'shield': {
      const pts: [number, number, number][] = [
        [cx - s / 2, base + s, cz],
        [cx + s / 2, base + s, cz],
        [cx + s / 3, base + s / 3, cz],
        [cx, base, cz],
        [cx - s / 3, base + s / 3, cz],
      ];
      pushRect(segs, 0, pts);
      break;
    }
  }
  return segs;
}

export interface Scene {
  segments: Segment[];
  visible: Set<number>;
  radius: number;
  brightest: number;
}

/** Collect every world-space segment the current state calls for. */
export function buildScene(content: Content, state: GameState, radius: number, brightest: number, nowMs: number): Scene {
  const level = content.levels[state.player.levelId]!;
  const p = state.player;
  const effRadius = Math.max(0, radius);
  const visible = visibleCells(level, p.x, p.y, effRadius);
  const segs: Segment[] = [];
  const seen = new Set<string>();
  const runtime = state.levels[p.levelId]!;

  for (const idx of visible) {
    const x = idx % level.size.w;
    const y = Math.floor(idx / level.size.w);
    const cellDist = Math.hypot(x - p.x, y - p.y);
    for (const side of SIDES) {
      if (!(cellAt(level, x, y).walls & SIDE_BIT[side])) continue;
      const key = wallKey(x, y, side);
      if (seen.has(key)) continue;
      seen.add(key);
      pushRect(
        segs,
        cellDist,
        wallCorners(x, y, side).map(([wx, wy, wz]) => [wx, wy, wz] as [number, number, number]),
      );
      const door = doorAt(level, x, y, side);
      if (door && (!door.secret || runtime.discoveredSecrets.includes(`${door.at[0]},${door.at[1]},${door.side}`))) {
        for (const s of doorFrame(x, y, side)) segs.push({ ...s, dist: cellDist });
      }
    }
    const feature = cellAt(level, x, y).feature;
    if (feature === 'stairsDown') for (const s of stairsDownGeometry(x, y)) segs.push({ ...s, dist: cellDist });
    if (feature === 'stairsUp') for (const s of stairsUpGeometry(x, y)) segs.push({ ...s, dist: cellDist });

    for (const item of runtime.floorItems) {
      if (item.x !== x || item.y !== y) continue;
      const def = content.items[item.inst.defId]!;
      for (const s of itemIconGeometry(def.kind, x, y, nowMs / 700 + item.x * 3 + item.y)) {
        segs.push({ ...s, dist: cellDist });
      }
    }
  }
  return { segments: segs, visible, radius: effRadius, brightest };
}

const NEAR = tuning.render.nearClip;
const LEVELS = tuning.render.intensityLevels;

/** Dash pattern index for a segment: 0 brightest .. LEVELS-1 dimmest. */
export function intensityIndex(dist: number, radius: number, brightest: number): number {
  if (radius <= 0) return LEVELS - 1;
  const falloff = Math.min(LEVELS - 1, Math.floor((dist / (radius + 1)) * LEVELS));
  const cap = LEVELS - Math.max(1, Math.min(LEVELS, brightest));
  return Math.min(LEVELS - 1, Math.max(falloff, cap));
}

export interface SceneInsert {
  /** Camera-space depth at which this drawable sits in painter order. */
  depth: number;
  draw: () => void;
}

/** Project and stroke the scene, back to front, interleaving inserts
 * (creature billboards) at their own depth so near walls overdraw them. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  cam: Camera,
  fg: string,
  inserts: SceneInsert[] = [],
): void {
  interface Drawable {
    depth: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    dash: number[];
  }
  const drawables: Drawable[] = [];
  for (const seg of scene.segments) {
    let [ax, ay, az] = toCameraSpace(cam, seg.ax, seg.ay, seg.az);
    let [bx, by, bz] = toCameraSpace(cam, seg.bx, seg.by, seg.bz);
    if (az < NEAR && bz < NEAR) continue;
    if (az < NEAR || bz < NEAR) {
      const t = (NEAR - az) / (bz - az);
      const ix = ax + (bx - ax) * t;
      const iy = ay + (by - ay) * t;
      if (az < NEAR) {
        ax = ix;
        ay = iy;
        az = NEAR;
      } else {
        bx = ix;
        by = iy;
        bz = NEAR;
      }
    }
    const a = projectCameraSpace(ax, ay, az);
    const b = projectCameraSpace(bx, by, bz);
    const idx = intensityIndex(seg.dist, scene.radius, scene.brightest);
    drawables.push({
      depth: Math.max(az, bz),
      ax: a.sx,
      ay: a.sy,
      bx: b.sx,
      by: b.sy,
      dash: tuning.render.dashPatterns[idx]!,
    });
  }
  drawables.sort((a, b) => b.depth - a.depth);
  const queue = [...inserts].sort((a, b) => b.depth - a.depth);

  ctx.save();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  let qi = 0;
  for (const d of drawables) {
    while (qi < queue.length && queue[qi]!.depth >= d.depth) {
      ctx.setLineDash([]);
      queue[qi]!.draw();
      qi++;
      ctx.strokeStyle = fg;
    }
    ctx.setLineDash(d.dash);
    ctx.beginPath();
    ctx.moveTo(Math.round(d.ax) + 0.5, Math.round(d.ay) + 0.5);
    ctx.lineTo(Math.round(d.bx) + 0.5, Math.round(d.by) + 0.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  while (qi < queue.length) {
    queue[qi]!.draw();
    qi++;
  }
  ctx.restore();
}
