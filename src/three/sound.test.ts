import { describe, expect, it } from "vitest";
import type { GameEvent } from "../sim/types";
import { CHASSIS } from "../data/chassis";
import { engineFileFor, hornSoundFor, MIX, SOUNDS } from "../data/sounds";
import type { SoundPlayer } from "../audio/player";
import { engineGlide, loopLevels, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { CameraRig } from "./render/camera";

describe("stingOf", () => {
  it("plays the most important result only", () => {
    const events: GameEvent[] = [
      { t: "money", amount: 20, reason: "sale" },
      { t: "levelUp", level: 2 },
      { t: "discover", location: "oasis" },
    ];
    expect(stingOf(events, "p")).toBe("level-up");
  });
  it("ignores spending and other drivers' arrivals", () => {
    const events: GameEvent[] = [
      { t: "money", amount: -5, reason: "fuel" },
      { t: "arrived", vehicle: "npc1" },
    ];
    expect(stingOf(events, "p")).toBeNull();
    expect(stingOf([{ t: "arrived", vehicle: "p" }], "p")).toBe("air-brake");
  });
  it("plays the defeat cue on a knockout", () => {
    expect(stingOf([{ t: "levelUp", level: 2 }, { t: "knockout" }], "p")).toBe("defeat");
  });
});

describe("loopLevels", () => {
  const calm = { stormTiles: 100, turnsSinceDanger: Infinity };
  it("raises wind near storms", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormTiles: 0 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in danger", () => {
    const l = loopLevels({ ...calm, turnsSinceDanger: 0 }, MIX);
    expect([l.calmGain, l.combatGain]).toEqual([0, 1]);
  });
  it("holds combat music for a few turns after the last hostile leaves sight", () => {
    const hold = MIX.music.holdTurns;
    expect(loopLevels({ ...calm, turnsSinceDanger: hold }, MIX).combatGain).toBe(1);
    expect(loopLevels({ ...calm, turnsSinceDanger: hold + 1 }, MIX).combatGain).toBe(0);
  });
});

describe("engine sound assignment", () => {
  it("assigns an existing recording to every chassis", () => {
    for (const id of Object.keys(CHASSIS)) {
      expect(SOUNDS.engine.files).toContain(engineFileFor(id));
    }
    expect(engineFileFor("scout")).not.toBe(engineFileFor("hauler"));
    expect(() => engineFileFor("unknown")).toThrow("Unknown chassis");
  });

  it("changes the engine loop only when the chassis changes", () => {
    const started: string[] = [];
    const stopped: number[] = [];
    const player = {
      loop: (id: string, _at: unknown, file?: string) => {
        if (id === "engine") started.push(file ?? "random");
        return { glide: () => {}, setGain: () => {}, stop: (ms: number) => stopped.push(ms) };
      },
    } as unknown as SoundPlayer;
    const loops = new SoundLoops(player);
    const glide = engineGlide(0, 10, 1, MIX)!;

    loops.drive(glide, "scout");
    loops.drive(glide, "scout");
    loops.drive(glide, "hauler");

    expect(started).toEqual([engineFileFor("scout"), engineFileFor("hauler")]);
    expect(stopped).toEqual([0]);
  });
});

describe("horn sound assignment", () => {
  it("gives every chassis a distinct, loaded horn and rejects unknown chassis", () => {
    const sounds = Object.keys(CHASSIS).map((id) => hornSoundFor(id));
    expect(sounds.every((sound) => SOUNDS.horn.files.includes(sound.file))).toBe(true);
    expect(new Set(sounds.map((sound) => `${sound.file}:${sound.rate}`)).size).toBe(sounds.length);
    expect(() => hornSoundFor("unknown")).toThrow("Unknown chassis");
  });

  it("plays the assigned horn at the vehicle's position after its delay", () => {
    const calls: unknown[][] = [];
    const player: Pick<SoundPlayer, "play"> = { play: (...args) => { calls.push(args); } };
    const rig: Pick<CameraRig, "focus" | "screenOf"> = {
      focus: () => ({ x: 0, y: 0, z: 0 }),
      screenOf: () => ({ x: 50, y: 50 }),
    };
    const width = globalThis.window?.innerWidth;
    Object.defineProperty(globalThis, "window", { value: { innerWidth: 100 }, configurable: true });
    try {
      const director = new SoundDirector(player, rig);
      director.honk({ x: 0, y: 0, z: 0 }, 500, "scout");
      expect(calls).toEqual([["horn", { pan: 0, gain: 1 }, 500, hornSoundFor("scout")]]);
    } finally {
      if (width === undefined) Reflect.deleteProperty(globalThis, "window");
      else Object.defineProperty(globalThis, "window", { value: { innerWidth: width }, configurable: true });
    }
  });
});

describe("engineGlide", () => {
  const e = MIX.engine;
  it("stays silent while standing still", () => {
    expect(engineGlide(0, 0, 1, MIX)).toBeNull();
  });
  it("revs up while speeding up and holds while cruising", () => {
    const up = engineGlide(0, e.topSpeedMs * 2, 1, MIX)!;
    expect([up.rateFrom, up.rateTo]).toEqual([e.idleRate, e.topRate + e.revUp]);
    expect([up.gainFrom, up.gainTo]).toEqual([e.idleGain, 1 + e.loadGain]);
    expect(up.brake).toBe(false);
    const cruise = engineGlide(10, 10, 1, MIX)!;
    expect(cruise.rateTo).toBe(cruise.rateFrom);
  });
  it("drops revs while slowing", () => {
    const g = engineGlide(10, 10 - e.loadMs, 1, MIX)!;
    expect(g.rateFrom - g.rateTo).toBeGreaterThan(e.revDown);
  });
  it("adds the air brake on a hard slowdown only", () => {
    expect(engineGlide(10, 10 - e.brakeMs, 1, MIX)!.brake).toBe(true);
    expect(engineGlide(10, 10 - e.brakeMs / 2, 1, MIX)!.brake).toBe(false);
  });
});
