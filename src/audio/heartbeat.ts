// The heartbeat scheduler. Reads the pulse each animation frame and
// schedules the next beats ahead of the audio clock, so rate changes
// glide instead of jumping. Above the faint threshold an irregular
// second thump layers in.

import { tuning } from '../config/tuning.ts';
import type { AudioEngine } from './engine.ts';

export class Heartbeat {
  private engine: AudioEngine;
  private nextBeatAt = 0;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  /** Call every frame with the current pulse in bpm. */
  update(pulse: number, running: boolean): void {
    const ctx = this.engine.context;
    const out = this.engine.output;
    if (!ctx || !out || !running) return;
    const now = ctx.currentTime;
    if (this.nextBeatAt < now) this.nextBeatAt = now + 0.05;
    const interval = 60 / Math.max(30, pulse);
    while (this.nextBeatAt < now + tuning.audio.heartbeatLookahead) {
      this.scheduleBeat(ctx, out, this.nextBeatAt, pulse);
      this.nextBeatAt += interval;
    }
  }

  private thump(ctx: AudioContext, out: AudioNode, t: number, freq: number, peak: number): void {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.09);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  private scheduleBeat(ctx: AudioContext, out: AudioNode, t: number, pulse: number): void {
    // Lub, then dub a fraction later.
    this.thump(ctx, out, t, 68, 0.8);
    this.thump(ctx, out, t + 0.14, 54, 0.55);
    if (pulse >= tuning.pulse.faintThreshold) {
      // Irregular extra thump: arrhythmia at the edge of collapse.
      const jitter = 0.2 + Math.random() * 0.15;
      this.thump(ctx, out, t + jitter, 80, 0.4);
    }
  }
}
