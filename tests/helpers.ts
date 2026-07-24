// Shared test fixtures: content loading and a tiny hand-built level.

import { tuning } from '../src/config/tuning.ts';
import { validateItems } from '../src/sim/items.ts';
import { validateCreatures } from '../src/sim/creatures.ts';
import { validateLevel, type LevelDef, SIDE_BIT, type Side } from '../src/sim/world.ts';
import type { Content } from '../src/sim/step.ts';
import itemsRaw from '../src/data/items.json';
import creaturesRaw from '../src/data/creatures.json';
import level1 from '../src/data/levels/1.json';
import level2 from '../src/data/levels/2.json';
import level3 from '../src/data/levels/3.json';
import level4 from '../src/data/levels/4.json';
import level5 from '../src/data/levels/5.json';

export function loadContent(): Content {
  const levels: Record<number, LevelDef> = {};
  for (const raw of [level1, level2, level3, level4, level5]) {
    const level = validateLevel(raw, `levels/${(raw as LevelDef).id}.json`);
    levels[level.id] = level;
  }
  return {
    items: validateItems(itemsRaw, 'items.json'),
    creatures: validateCreatures(creaturesRaw, 'creatures.json'),
    levels,
    tuning,
  };
}

/**
 * Build a small open level for focused tests. `wallSegments` lists
 * extra internal walls as [x, y, side]; the perimeter is always walled.
 */
export function makeTestLevel(
  w: number,
  h: number,
  wallSegments: [number, number, Side][] = [],
): LevelDef {
  const cells = Array.from({ length: w * h }, () => ({ walls: 0, feature: 'none' }));
  const set = (x: number, y: number, side: Side) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    cells[y * w + x]!.walls |= SIDE_BIT[side];
  };
  for (let x = 0; x < w; x++) {
    set(x, 0, 'N');
    set(x, h - 1, 'S');
  }
  for (let y = 0; y < h; y++) {
    set(0, y, 'W');
    set(w - 1, y, 'E');
  }
  const opposite: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const delta: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  for (const [x, y, side] of wallSegments) {
    set(x, y, side);
    const [dx, dy] = delta[side];
    set(x + dx, y + dy, opposite[side]);
  }
  return validateLevel(
    {
      id: 1,
      size: { w, h },
      cells,
      features: {},
      itemsPlaced: [],
      creatureSpawns: [],
      ambientSeed: 1,
    },
    'test level',
  );
}

/** Content with a single small test level and the real item/creature defs. */
export function testContent(level: LevelDef): Content {
  return {
    items: validateItems(itemsRaw, 'items.json'),
    creatures: validateCreatures(creaturesRaw, 'creatures.json'),
    levels: { [level.id]: level },
    tuning,
  };
}
