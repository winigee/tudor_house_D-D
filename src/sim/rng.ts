// Seeded deterministic RNG (mulberry32). Every random draw in the
// simulation goes through an Rng instance owned by the game state.
// The cursor (internal 32-bit state) serialises with the save.

export interface RngState {
  cursor: number;
}

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  static fromState(state: RngState): Rng {
    return new Rng(state.cursor);
  }

  state(): RngState {
    return { cursor: this.s >>> 0 };
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('rng.pick on empty array');
    return arr[this.int(0, arr.length - 1)]!;
  }
}
