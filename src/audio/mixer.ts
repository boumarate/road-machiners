// Web Audio graph: one bus per sound group into a master gain. The effects bus runs through a compressor
// and a short reverb, so sounds from different sources sit in one space.

import { MIX, type Bus } from "../data/sounds";

type Mix = typeof MIX;

export class Mixer {
  readonly ctx = new AudioContext();
  private master = this.ctx.createGain();
  private buses: Record<Bus, GainNode>;

  constructor(mix: Mix) {
    this.master.connect(this.ctx.destination);
    this.buses = {
      ui: this.bus(mix.busVolume.ui, this.master),
      sfx: this.bus(mix.busVolume.sfx, this.effectsChain(mix)),
      ambient: this.bus(mix.busVolume.ambient, this.master),
      music: this.bus(mix.busVolume.music, this.master),
    };
  }

  input(bus: Bus): AudioNode {
    return this.buses[bus];
  }

  setBusVolume(bus: Bus, volume: number): void {
    this.buses[bus].gain.value = volume;
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : 1;
  }

  // Browsers keep the context suspended until the first user input.
  unlockOn(target: EventTarget): void {
    const resume = () => void this.ctx.resume();
    target.addEventListener("pointerdown", resume, { once: true });
    target.addEventListener("keydown", resume, { once: true });
  }

  private bus(volume: number, out: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = volume;
    g.connect(out);
    return g;
  }

  // Returns the chain input: compressor to master dry, plus a reverb send.
  private effectsChain(mix: Mix): AudioNode {
    const c = mix.compressor;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = c.threshold;
    comp.knee.value = c.knee;
    comp.ratio.value = c.ratio;
    comp.attack.value = c.attack;
    comp.release.value = c.release;
    comp.connect(this.master);
    const verb = this.ctx.createConvolver();
    verb.buffer = this.impulse(mix.reverb.seconds, mix.reverb.decay);
    const wet = this.ctx.createGain();
    wet.gain.value = mix.reverb.wet;
    comp.connect(verb).connect(wet).connect(this.master);
    return comp;
  }

  // Stereo noise with a power decay: a plain open-air tail.
  private impulse(seconds: number, decay: number): AudioBuffer {
    const n = Math.round(seconds * this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }
}
