import { describe, expect, it } from "vitest";
import type { GameEvent, ShotRound } from "../sim/types";
import { CHASSIS } from "../data/chassis";
import { engineFileFor, hornSoundFor, MIX, scorePhaseOf, SOUNDS } from "../data/sounds";
import type { SoundPlayer } from "../audio/player";
import { accentOf, clashed, CombatScore, CombatWatch, engineGlide, loopLevels, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { CameraRig } from "./render/camera";

describe("stingOf", () => {
  it("plays the most important result only", () => {
    const events: GameEvent[] = [
      { t: "money", amount: 20, reason: "sale" },
      { t: "skillUp", skill: "driving", level: 2 },
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
    expect(stingOf([{ t: "skillUp", skill: "driving", level: 2 }, { t: "knockout" }], "p")).toBe("defeat");
  });
});

describe("loopLevels", () => {
  const calm = { stormTiles: 100, turnsSinceDanger: Infinity, turnsSinceClash: Infinity };
  it("raises wind near storms", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormTiles: 0 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in danger", () => {
    const l = loopLevels({ ...calm, turnsSinceDanger: 0 }, MIX);
    expect([l.calmGain, l.drumsGain, l.bassGain]).toEqual([0, 1, 0]);
  });
  it("holds combat music for a few turns after the last hostile leaves sight", () => {
    const hold = MIX.music.holdTurns;
    expect(loopLevels({ ...calm, turnsSinceDanger: hold }, MIX).drumsGain).toBe(1);
    expect(loopLevels({ ...calm, turnsSinceDanger: hold + 1 }, MIX).drumsGain).toBe(0);
  });
  it("adds the bass for a few turns after shots fly, only while the drums play", () => {
    const hold = MIX.score.clashHoldTurns;
    const danger = { ...calm, turnsSinceDanger: 0 };
    expect(loopLevels({ ...danger, turnsSinceClash: hold }, MIX).bassGain).toBe(1);
    expect(loopLevels({ ...danger, turnsSinceClash: hold + 1 }, MIX).bassGain).toBe(0);
    expect(loopLevels({ ...calm, turnsSinceClash: 0 }, MIX).bassGain).toBe(0);
  });
});

describe("accentOf", () => {
  const round = (hit: boolean, crit = false): ShotRound => ({ hit, crit, offset: 0, hits: [] });
  const shot = (shooter: string, target: string, rounds: ShotRound[]): GameEvent => ({
    t: "shot", shooter, weapon: "w", target, aim: "body", chance: 0.5, side: "front", rounds,
  });
  it("answers the player's volleys with hit, miss or crit", () => {
    expect(accentOf(shot("p", "n", [round(false), round(true)]), "p")).toBe("accent-hit");
    expect(accentOf(shot("p", "n", [round(false), round(false)]), "p")).toBe("accent-miss");
    expect(accentOf(shot("p", "n", [round(true), round(true, true)]), "p")).toBe("accent-crit");
  });
  it("answers volleys at the player with struck or crit, and enemy misses with nothing", () => {
    expect(accentOf(shot("n", "p", [round(true)]), "p")).toBe("accent-struck");
    expect(accentOf(shot("n", "p", [round(true, true)]), "p")).toBe("accent-crit");
    expect(accentOf(shot("n", "p", [round(false)]), "p")).toBeNull();
    expect(accentOf({ t: "guardShot", site: "s", from: { x: 0, y: 0 }, target: "p", rounds: [round(true)] }, "p")).toBe("accent-struck");
  });
  it("counts a round that strikes parts without a clean hit as struck", () => {
    const grazing: ShotRound = { hit: false, crit: false, offset: 0, hits: [{ part: "armor", damage: 3 }] };
    expect(accentOf(shot("p", "n", [grazing]), "p")).toBe("accent-hit");
  });
  it("ignores fights between other trucks and answers the player's crashes", () => {
    expect(accentOf(shot("a", "b", [round(true, true)]), "p")).toBeNull();
    expect(accentOf({ t: "collision", a: "n", b: "p", hitsA: [], hitsB: [] }, "p")).toBe("accent-crash");
    expect(accentOf({ t: "collision", a: "n", b: "m", hitsA: [], hitsB: [] }, "p")).toBeNull();
  });
  it("marks a clash only for shots by or at the player", () => {
    expect(clashed([shot("p", "n", [round(false)])], "p")).toBe(true);
    expect(clashed([shot("n", "p", [round(false)])], "p")).toBe(true);
    expect(clashed([shot("a", "b", [round(true)])], "p")).toBe(false);
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
    const loops = new SoundLoops(player, { setLevels: () => {} });
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
      const director = new SoundDirector(player, rig, { accent: () => true });
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

describe("CombatWatch", () => {
  it("flags a hostile when it comes into sight after a whole turn out of it", () => {
    const watch = new CombatWatch();
    expect(watch.observe(1, ["a"], false).sighted).toBe(true);
    expect(watch.observe(1, ["a"], false).sighted).toBe(false);
    expect(watch.observe(2, [], false).sighted).toBe(false);
    expect(watch.observe(4, ["a"], false).sighted).toBe(true);
  });
  it("ignores sight flicker inside a turn and into the next", () => {
    const watch = new CombatWatch();
    watch.observe(1, ["a"], false);
    watch.observe(1, [], false);
    expect(watch.observe(1, ["a"], false).sighted).toBe(false);
    watch.observe(2, [], false);
    expect(watch.observe(2, ["a"], false).sighted).toBe(false);
  });
  it("counts turns since the last danger and clash", () => {
    const watch = new CombatWatch();
    expect(watch.observe(1, [], false)).toMatchObject({ turnsSinceDanger: Infinity, turnsSinceClash: Infinity });
    watch.observe(2, ["a"], true);
    expect(watch.observe(5, [], false)).toMatchObject({ turnsSinceDanger: 3, turnsSinceClash: 3 });
  });
});

describe("CombatScore", () => {
  type Call = { id: string; file: string; when: number; offset: number; ducks: number[] };
  const fakePlayer = (lengths: Record<string, number>) => {
    const loops: Call[] = [];
    const plays: unknown[][] = [];
    const player = {
      now: () => 2,
      play: (...args: unknown[]) => { plays.push(args); },
      beatLoop: (id: string, file: string, when: number, offset: number) => {
        const call: Call = { id, file, when, offset, ducks: [] };
        loops.push(call);
        return { duration: lengths[id], setGain: () => {}, glide: () => {}, stop: () => {}, duck: (t: number) => call.ducks.push(t) };
      },
    } as unknown as SoundPlayer;
    return { player, loops, plays };
  };
  const bars = SOUNDS["score-drums"].beat!.bars;

  it("starts both layers at one time, each at its first beat", () => {
    const { player, loops } = fakePlayer({ "score-drums": 32, "score-bass": 32 });
    new CombatScore(player, () => 0);
    expect(loops.map((l) => l.when)).toEqual([loops[0].when, loops[0].when]);
    expect(loops.map((l) => l.offset)).toEqual(loops.map((l) => scorePhaseOf(l.file)));
  });

  it("fails when the layers differ in length", () => {
    const { player } = fakePlayer({ "score-drums": 32, "score-bass": 32.1 });
    expect(() => new CombatScore(player, () => 0)).toThrow("differ in length");
  });

  it("plays an accent on the beat grid and ducks both layers there", () => {
    const beat = 1; // one second per beat
    const { player, loops, plays } = fakePlayer({ "score-drums": bars * 4 * beat, "score-bass": bars * 4 * beat });
    const score = new CombatScore(player, () => 0);
    expect(score.accent("accent-hit", 0)).toBe(true);
    const start = loops[0].when;
    const slot = beat / MIX.score.subdivision;
    const time = start + Math.ceil((2 - start) / slot) * slot;
    const [cue, at, delayMs] = plays[0] as [string, { gain: number }, number];
    expect([cue, at.gain]).toEqual(["accent-hit", 1]);
    expect(delayMs).toBeCloseTo((time - 2) * 1000);
    expect(loops.map((l) => l.ducks)).toEqual([[time], [time]]);
  });
});
