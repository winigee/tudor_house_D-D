// Player state: position, facing, hands, pack, pulse and exertion.

import type { Facing } from './world.ts';
import type { ItemDef, ItemInstance } from './items.ts';

export type Hand = 'LEFT' | 'RIGHT';

export interface PlayerState {
  levelId: number;
  x: number;
  y: number;
  facing: Facing;
  hands: { LEFT: ItemInstance | null; RIGHT: ItemInstance | null };
  pack: ItemInstance[];
  pulse: number;
  exertion: number;
  knownWords: string[];
  alive: boolean;
}

export function makePlayer(levelId: number, x: number, y: number, facing: Facing, restingPulse: number): PlayerState {
  return {
    levelId,
    x,
    y,
    facing,
    hands: { LEFT: null, RIGHT: null },
    pack: [],
    pulse: restingPulse,
    exertion: 0,
    knownWords: [],
    alive: true,
  };
}

export function carriedWeight(player: PlayerState, defs: Record<string, ItemDef>): number {
  let total = 0;
  for (const inst of [player.hands.LEFT, player.hands.RIGHT, ...player.pack]) {
    if (inst) total += defs[inst.defId]!.weight;
  }
  return total;
}

export function otherHand(hand: Hand): Hand {
  return hand === 'LEFT' ? 'RIGHT' : 'LEFT';
}
