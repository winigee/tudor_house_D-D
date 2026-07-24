// Web Audio graph: one context created at first user gesture, a master
// gain with mute, and helpers for panned, distance-attenuated sources.

import { tuning } from '../config/tuning.ts';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  /** Call from a user-gesture handler; browsers block audio before one. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : tuning.audio.masterGain;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get output(): GainNode | null {
    return this.master;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : tuning.audio.masterGain;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * A gain+panner pair for a positional sound. Distance attenuates by
   * inverse square with a floor, so far creatures stay faintly audible.
   */
  spatial(distance: number, bearing: number): { input: AudioNode; connect: () => void } | null {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return null;
    const gain = ctx.createGain();
    const ref = tuning.audio.footstepReferenceDistance;
    const atten = Math.max(tuning.audio.attenuationFloor, 1 / Math.pow(Math.max(ref, distance) / ref, 2));
    gain.gain.value = atten;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, Math.sin(bearing)));
    gain.connect(pan);
    return { input: gain, connect: () => pan.connect(master) };
  }
}
