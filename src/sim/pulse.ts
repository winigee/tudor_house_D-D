// The pulse model. The player has no hit points: exertion feeds the
// pulse, rest drains it, and a pulse held above the ceiling kills.

import type { Tuning } from '../config/tuning.ts';
import type { PlayerState } from './player.ts';

/** Advance exertion decay and pulse approach by one tick. */
export function tickPulse(player: PlayerState, weight: number, tuning: Tuning): void {
  const p = tuning.pulse;
  player.exertion = Math.max(0, player.exertion - p.exertionDecayPerTick);
  const conversion = p.conversionPerUnit * (1 + weight / p.weightReference);
  const target = p.resting + conversion * player.exertion;
  player.pulse += (target - player.pulse) * p.approachFactor;
  if (player.pulse < p.resting) player.pulse = p.resting;
}

/** A creature landed a hit: shock goes straight onto the pulse. */
export function applyShock(player: PlayerState, shock: number): void {
  player.pulse += shock;
}

export function isDeadFromPulse(player: PlayerState, tuning: Tuning): boolean {
  return player.pulse >= tuning.pulse.ceiling;
}

export function isFaint(player: PlayerState, tuning: Tuning): boolean {
  return player.pulse >= tuning.pulse.faintThreshold;
}

/** Probability that a command fumbles at the current pulse. */
export function faintFailChance(player: PlayerState, tuning: Tuning): number {
  const p = tuning.pulse;
  if (player.pulse < p.faintThreshold) return 0;
  const span = p.ceiling - p.faintThreshold;
  const frac = Math.min(1, (player.pulse - p.faintThreshold) / span);
  return p.faintFailFloor + frac * (p.faintFailCeil - p.faintFailFloor);
}
