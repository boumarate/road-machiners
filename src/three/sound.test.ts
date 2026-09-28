import { describe, expect, it } from "vitest";
import type { GameEvent, ShotRound } from "../sim/types";
import { CHASSIS } from "../data/chassis";
import { engineFileFor, hornSoundFor, MIX, scorePhaseOf, SOUNDS } from "../data/sounds";
import type { SoundPlayer } from "../audio/player";
import { accentOf, CombatScore, CombatWatch, engineGlide, loopLevels, SoundDirector, SoundLoops, stingOf } from "./sound";
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
  const calm = { stormTiles: 100, turnsSinceDanger: Infinity, paused: false };
  it("raises wind near storms", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormTiles: 0 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in danger", () => {
    const l = loopLevels({ ...calm, turnsSinceDanger: 0 }, MIX);
    expect([l.calmGain, l.combatGain]).toEqual([0, 1]);
  });
  it("muffles music during a pause between turns", () => {
    expect(loopLevels(calm, MIX).musicCutoffHz).toBe(MIX.music.openCutoffHz);
    expect(loopLevels({ ...calm, paused: true }, MIX).musicCutoffHz).toBe(MIX.music.pauseCutoffHz);
  });
  it("holds combat music for a few turns after the last hostile leaves sight", () => {
    const hold = MIX.music.holdTurns;
    expect(loopLevels({ ...calm, turnsSinceDanger: hold }, MIX).combatGain).toBe(1);
    expect(loopLevels({ ...calm, turnsSinceDanger: hold + 1 }, MIX).combatGain).toBe(0);
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
    const loops = new SoundLoops(player, { setCombat: () => {}, setPaused: () => {}, tick: () => {} });
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
      const director = new SoundDirector(player, rig, { accent: () => { throw new Error("no accent here"); } });
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
    expect(watch.observe(1, ["a"]).sighted).toBe(true);
    expect(watch.observe(1, ["a"]).sighted).toBe(false);
    expect(watch.observe(2, []).sighted).toBe(false);
    expect(watch.observe(4, ["a"]).sighted).toBe(true);
  });
  it("ignores sight flicker inside a turn and into the next", () => {
    const watch = new CombatWatch();
    watch.observe(1, ["a"]);
    watch.observe(1, []);
    expect(watch.observe(1, ["a"]).sighted).toBe(false);
    watch.observe(2, []);
    expect(watch.observe(2, ["a"]).sighted).toBe(false);
  });
  it("counts turns since the last danger", () => {
    const watch = new CombatWatch();
    expect(watch.observe(1, []).turnsSinceDanger).toBe(Infinity);
    watch.observe(2, ["a"]);
    expect(watch.observe(5, []).turnsSinceDanger).toBe(3);
  });
});

describe("CombatScore", () => {
  type Call = { id: string; file: string; when: number; offset: number; gains: number[]; tones: number[]; ducks: number[]; stoppedAt: number | null };
  type Play = [string, { pan: number; gain: number }, number];
  const fakePlayer = () => {
    const loops: Call[] = [];
    const plays: Play[] = [];
    const clock = { now: 2 };
    const player = {
      now: () => clock.now,
      play: (...args: Play) => { plays.push(args); },
      beatLoop: (id: string, file: string, when: number, offset: number) => {
        const call: Call = { id, file, when, offset, gains: [], tones: [], ducks: [], stoppedAt: null };
        loops.push(call);
        return {
          duration: 0,
          setGain: (g: number) => call.gains.push(g),
          setTone: (hz: number) => call.tones.push(hz),
          glide: () => {},
          stop: () => { call.stoppedAt = clock.now; },
          stopAt: (t: number) => { call.stoppedAt = t; },
          duck: (t: number) => call.ducks.push(t),
        };
      },
    } as unknown as SoundPlayer;
    return { player, loops, plays, clock };
  };
  const run = (score: CombatScore, clock: { now: number }, seconds: number) => {
    for (let t = 0; t < seconds * 20; t++) {
      clock.now += 0.05;
      score.tick();
    }
  };
  const s = MIX.score;
  const barOf = (cue: keyof typeof SOUNDS) => (60 / SOUNDS[cue].beat!.bpm) * 4;

  it("starts no base before a battle, then one at the tempo its heat wants, from its first bar", () => {
    const { player, loops } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    expect(loops).toEqual([]);
    score.setCombat(true, 3);
    expect(loops.map((l) => [l.id, l.offset])).toEqual([["score-drums-slow", scorePhaseOf("score-drums-slow-1.ogg")]]);
    expect(loops[0].gains).toEqual([s.quietGain]);
    expect(loops[0].tones).toEqual([s.quietCutoffHz]);
  });

  it("fades the base out when the battle ends and picks a base per battle", () => {
    const { player, loops } = fakePlayer();
    const rolls = [0, 0, 0.9]; // base, secondary side, base
    const score = new CombatScore(player, () => rolls.shift() ?? 0);
    score.setCombat(true, 3);
    score.setCombat(false, 3);
    score.setCombat(true, 3);
    expect(loops.map((l) => l.id)).toEqual(["score-drums-slow", "score-bass-slow"]);
    expect(loops[0].stoppedAt).not.toBeNull();
  });

  it("ignores accents outside a battle", () => {
    const { player, plays } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    expect(score.accent("accent-crash", 0)).toBeNull();
    score.setCombat(true, 3);
    score.setCombat(false, 3);
    expect(score.accent("accent-crash", 0)).toBeNull();
    expect(plays).toEqual([]);
  });

  it("queues an event's phrase and plays it on the lead, ducking the base under each hit", () => {
    const { player, loops, plays, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    expect(score.accent("accent-sighted", 0)).toMatchObject({ cue: "accent-sighted", offer: "queued" });
    run(score, clock, 8);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((p) => p[0] === "accent-sighted" && p[1].pan === 0)).toBe(true);
    expect(loops.flatMap((l) => l.ducks)).toHaveLength(plays.length);
  });

  it("plays light events on the secondary, to one side, without ducking the base", () => {
    const { player, loops, plays, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    score.accent("accent-hit", 0);
    run(score, clock, 8);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((p) => p[0] === "accent-hit" && p[1].pan === -s.secondaryPan)).toBe(true);
    expect(loops.flatMap((l) => l.ducks)).toEqual([]);
  });

  it("steps the tempo one copy per bar toward the heat, at the same bar of the loop, and opens the base", () => {
    const { player, loops, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    for (let i = 0; i < 5; i++) score.accent("accent-crash", 0);
    run(score, clock, barOf("score-drums-slow") + 0.5);
    expect(loops.map((l) => l.id)).toEqual(["score-drums-slow", "score-drums"]);
    const switchAt = loops[1].when;
    expect(loops[0].stoppedAt).toBe(switchAt);
    expect(loops[1].offset).toBeCloseTo(scorePhaseOf("score-drums-1.ogg") + barOf("score-drums"));
    expect(loops[1].gains.at(-1)).toBeGreaterThan(s.quietGain);
    run(score, clock, barOf("score-drums"));
    expect(loops.map((l) => l.id)).toEqual(["score-drums-slow", "score-drums", "score-drums-fast"]);
  });
});
