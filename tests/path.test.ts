import { describe, expect, it } from 'vitest';
import { makeTestLevel } from './helpers.ts';
import { bfsPath, bfsDistance, lineOfSight, canPass } from '../src/sim/world.ts';

describe('pathfinding', () => {
  it('finds a straight path in the open', () => {
    const level = makeTestLevel(6, 6);
    const path = bfsPath(level, 1, 1, 4, 1, { throughSecret: false });
    expect(path).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
  });

  it('routes around a wall', () => {
    // A wall across x=2 between y=0..1 forces a detour south.
    const level = makeTestLevel(6, 3, [
      [1, 0, 'E'],
      [1, 1, 'E'],
    ]);
    const path = bfsPath(level, 1, 0, 3, 0, { throughSecret: false });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);
    expect(path![path!.length - 1]).toEqual([3, 0]);
  });

  it('returns null when no route exists', () => {
    // Seal off the right half completely.
    const level = makeTestLevel(4, 2, [
      [1, 0, 'E'],
      [1, 1, 'E'],
    ]);
    expect(bfsPath(level, 0, 0, 3, 0, { throughSecret: false })).toBeNull();
    expect(bfsDistance(level, 0, 0, 3, 0, { throughSecret: false })).toBe(Infinity);
  });

  it('avoids blocked cells', () => {
    const level = makeTestLevel(5, 1);
    const blocked = (x: number, y: number) => x === 2 && y === 0;
    expect(bfsPath(level, 0, 0, 4, 0, { throughSecret: false }, blocked)).toBeNull();
  });

  it('secret doors stop creatures but not the player', () => {
    const level = makeTestLevel(4, 1, [[1, 0, 'E']]);
    level.features.door = [{ at: [1, 0], side: 'E', secret: true }];
    expect(canPass(level, 1, 0, 'E', { throughSecret: false })).toBe(false);
    expect(canPass(level, 1, 0, 'E', { throughSecret: true })).toBe(true);
    expect(bfsPath(level, 0, 0, 3, 0, { throughSecret: false })).toBeNull();
    expect(bfsPath(level, 0, 0, 3, 0, { throughSecret: true })).not.toBeNull();
  });

  it('line of sight follows corridors and stops at walls', () => {
    const level = makeTestLevel(6, 3, [[3, 1, 'E']]);
    expect(lineOfSight(level, 1, 1, 3, 1)).toBe(true);
    expect(lineOfSight(level, 1, 1, 5, 1)).toBe(false);
    expect(lineOfSight(level, 1, 1, 3, 2)).toBe(false); // not axis-aligned
  });
});
