// Creature and item sounds. Synthesis-first: square and noise
// oscillators cover everything, so the game plays with no audio files.
// Where a sample exists under assets/audio/, it is preferred.

import type { AudioEngine } from './engine.ts';

// Samples bundled at build time when present (none ship by default).
const sampleUrls: Record<string, string> = {};
const globbed = import.meta.glob('../assets/audio/*.{wav,mp3,ogg}', {
  eager: true,
  query: '?url',
  import: 'default',
});
for (const [path, url] of Object.entries(globbed)) {
  const name = path.split('/').pop()!.replace(/\.(wav|mp3|ogg)$/, '');
  sampleUrls[name] = url as string;
}

export class Cues {
  private engine: AudioEngine;
  private buffers = new Map<string, AudioBuffer | null>();
  private noiseBuffer: AudioBuffer | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  private async sample(ctx: AudioContext, id: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(id)) return this.buffers.get(id)!;
    const url = sampleUrls[id];
    if (!url) {
      this.buffers.set(id, null);
      return null;
    }
    try {
      const res = await fetch(url);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(id, buf);
      return buf;
    } catch {
      this.buffers.set(id, null);
      return null;
    }
  }

  /** Panned, attenuated creature footstep. Character comes from soundId. */
  footstep(soundId: string, distance: number, bearing: number): void {
    const ctx = this.engine.context;
    if (!ctx) return;
    const spatial = this.engine.spatial(distance, bearing);
    if (!spatial) return;
    spatial.connect();
    void this.sample(ctx, soundId).then((buf) => {
      const t = ctx.currentTime;
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(spatial.input);
        src.start(t);
        return;
      }
      this.synthFootstep(ctx, spatial.input, soundId, t);
    });
  }

  private synthFootstep(ctx: AudioContext, out: AudioNode, soundId: string, t: number): void {
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(ctx);
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    noise.connect(filter);
    filter.connect(env);
    env.connect(out);
    let freq = 800;
    let dur = 0.07;
    let peak = 0.5;
    switch (soundId) {
      case 'step_skitter':
        freq = 2600; dur = 0.03; peak = 0.35;
        break;
      case 'step_scratch':
        freq = 1800; dur = 0.05; peak = 0.3;
        break;
      case 'step_slither':
        freq = 700; dur = 0.22; peak = 0.25;
        break;
      case 'step_squelch':
        freq = 300; dur = 0.18; peak = 0.4;
        break;
      case 'step_clank':
        freq = 1200; dur = 0.09; peak = 0.6;
        break;
      case 'step_whisper':
        freq = 4000; dur = 0.3; peak = 0.15;
        break;
      case 'step_boom':
        freq = 120; dur = 0.25; peak = 0.9;
        break;
      case 'step_click':
        freq = 3200; dur = 0.025; peak = 0.45;
        break;
      case 'step_chime':
        freq = 1500; dur = 0.2; peak = 0.3;
        break;
    }
    filter.type = soundId === 'step_chime' ? 'bandpass' : 'lowpass';
    filter.frequency.value = freq;
    filter.Q.value = soundId === 'step_chime' ? 12 : 1;
    env.gain.setValueAtTime(peak, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.start(t);
    noise.stop(t + dur + 0.02);
  }

  private blip(freq: number, dur: number, peak: number, type: OscillatorType = 'square', slideTo?: number): void {
    const ctx = this.engine.context;
    const out = this.engine.output;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env.gain.setValueAtTime(peak, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(freq: number, dur: number, peak: number): void {
    const ctx = this.engine.context;
    const out = this.engine.output;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(peak, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filter);
    filter.connect(env);
    env.connect(out);
    noise.start(t);
    noise.stop(t + dur + 0.02);
  }

  swing(hit: boolean): void {
    this.noiseBurst(hit ? 900 : 1400, hit ? 0.12 : 0.18, 0.5);
    if (hit) this.blip(220, 0.1, 0.5, 'square', 90);
  }

  playerHit(blocked: boolean): void {
    if (blocked) this.blip(500, 0.08, 0.6, 'square', 350);
    else {
      this.blip(140, 0.25, 0.8, 'sawtooth', 60);
      this.noiseBurst(500, 0.2, 0.4);
    }
  }

  creatureDied(): void {
    this.blip(400, 0.35, 0.6, 'square', 50);
  }

  torchOut(): void {
    this.noiseBurst(250, 0.5, 0.4);
  }

  bump(): void {
    this.blip(90, 0.08, 0.5, 'square');
  }

  climb(): void {
    this.blip(300, 0.12, 0.4, 'square', 450);
    this.blip(450, 0.12, 0.4, 'square', 600);
  }

  secret(): void {
    this.blip(600, 0.3, 0.4, 'triangle', 1200);
  }

  incant(): void {
    this.blip(880, 0.4, 0.4, 'triangle', 220);
    this.noiseBurst(3000, 0.3, 0.15);
  }

  death(): void {
    this.blip(200, 1.6, 0.7, 'sawtooth', 30);
  }

  victory(): void {
    const notes = [262, 330, 392, 523];
    const ctx = this.engine.context;
    const out = this.engine.output;
    if (!ctx || !out) return;
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      env.gain.setValueAtTime(0.35, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(env);
      env.connect(out);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  }
}
