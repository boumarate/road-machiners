// Plays catalog cues: one-shots with a variant, pitch jitter and voice limit, and loops with live controls.

import type { Cue } from "../data/sounds";
import type { Bank } from "./bank";
import type { Mixer } from "./mixer";
import { pickVariant, VoiceLimiter } from "./pick";

export type Placement = { pan: number; gain: number };
export type SoundSelection = { file: string; rate: number };

export type LoopHandle = {
  setGain(gain: number, rampSeconds: number): void;
  // Fades in, moves rate and gain in a straight line over the span, and fades out at its end.
  glide(g: Glide): void;
  stop(fadeMs: number): void;
};

export type Glide = { rateFrom: number; rateTo: number; gainFrom: number; gainTo: number; seconds: number; fadeSeconds: number };


export class SoundPlayer {
  private last = new Map<string, number>();
  private voices = new VoiceLimiter();

  constructor(private mixer: Mixer, private bank: Bank, private sounds: Record<string, Cue>) {}

  play(id: string, at: Placement, delayMs: number, selection?: SoundSelection): void {
    const cue = this.cue(id);
    if (cue.loop) throw new Error(`Sound ${id} is a loop; use loop()`);
    const ctx = this.mixer.ctx;
    const buf = selection ? this.getBuffer(id, cue, selection.file) : this.variant(id, cue);
    const rate = selection ? this.checkedRate(id, selection.rate) : 1 + (Math.random() * 2 - 1) * cue.pitchJitter;
    const start = ctx.currentTime + delayMs / 1000;
    if (!this.voices.admit(id, cue.maxVoices, ctx.currentTime, start + buf.duration / rate)) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    this.chain(src, cue, at);
    src.start(start);
  }

  loop(id: string, at: Placement, file?: string): LoopHandle {
    const cue = this.cue(id);
    if (!cue.loop) throw new Error(`Sound ${id} is not a loop`);
    const ctx = this.mixer.ctx;
    const src = ctx.createBufferSource();
    src.buffer = file === undefined ? this.variant(id, cue) : this.getBuffer(id, cue, file);
    src.loop = true;
    const gain = this.chain(src, cue, at);
    src.start();
    return {
      setGain: (g, ramp) => gain.gain.setTargetAtTime(cue.volume * g, ctx.currentTime, ramp / 3),
      glide: (g) => {
        const t = ctx.currentTime;
        const rate = src.playbackRate;
        rate.cancelScheduledValues(t);
        rate.setValueAtTime(g.rateFrom, t);
        rate.linearRampToValueAtTime(g.rateTo, t + g.seconds);
        const level = gain.gain;
        level.cancelScheduledValues(t);
        level.setValueAtTime(level.value, t);
        level.linearRampToValueAtTime(cue.volume * g.gainFrom, t + g.fadeSeconds);
        level.linearRampToValueAtTime(cue.volume * g.gainTo, t + g.seconds - g.fadeSeconds);
        level.linearRampToValueAtTime(0, t + g.seconds);
      },
      stop: (fadeMs) => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, fadeMs / 1000 / 3);
        src.stop(ctx.currentTime + fadeMs / 1000);
      },
    };
  }

  private checkedRate(id: string, rate: number): number {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid playback rate for ${id}`);
    return rate;
  }

  private getBuffer(id: string, cue: Cue, file: string): AudioBuffer {
    if (!cue.files.includes(file)) throw new Error(`Sound ${id} has no file ${file}`);
    const buffer = this.bank.get(file);
    if (!buffer) throw new Error(`Sound file ${file} was not loaded`);
    return buffer;
  }

  private cue(id: string): Cue {
    const cue = this.sounds[id];
    if (!cue) throw new Error(`Unknown sound ${id}`);
    return cue;
  }

  private variant(id: string, cue: Cue): AudioBuffer {
    const i = pickVariant(cue.files.length, this.last.get(id) ?? null, Math.random());
    this.last.set(id, i);
    const buf = this.bank.get(cue.files[i]);
    if (!buf) throw new Error(`Sound file ${cue.files[i]} was not loaded`);
    return buf;
  }

  // Source -> gain -> pan -> bus. Returns the gain for live changes.
  private chain(src: AudioBufferSourceNode, cue: Cue, at: Placement): GainNode {
    const ctx = this.mixer.ctx;
    const gain = ctx.createGain();
    gain.gain.value = cue.volume * at.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = at.pan;
    src.connect(gain).connect(pan).connect(this.mixer.input(cue.bus));
    return gain;
  }
}
