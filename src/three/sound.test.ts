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
  type BaseId = "score-drums" | "score-bass";
  type Call = { id: BaseId; file: string; when: number; offset: number; gains: number[]; tones: number[]; ducks: number[] };
  const fakePlayer = () => {
    const loops: Call[] = [];
    const plays: unknown[][] = [];
    const clock = { now: 2 };
    const player = {
      now: () => clock.now,
      play: (...args: unknown[]) => { plays.push(args); },
      beatLoop: (id: BaseId, file: string, when: number, offset: number) => {
        const call: Call = { id, file, when, offset, gains: [], tones: [], ducks: [] };
        loops.push(call);
        // One second per beat for every base.
        const duration = SOUNDS[id].beat!.bars * 4;
        return {
          duration,
          setGain: (g: number) => call.gains.push(g),
          setTone: (hz: number) => call.tones.push(hz),
          glide: () => {},
          stop: () => {},
          duck: (t: number) => call.ducks.push(t),
        };
      },
    } as unknown as SoundPlayer;
    return { player, loops, plays, clock };
  };
  const start = MIX.score.modes[MIX.score.startMode];

  it("starts every base silent at one time, each at its first beat", () => {
    const { player, loops } = fakePlayer();
    new CombatScore(player, () => 0);
    expect(loops.map((l) => l.id)).toEqual(["score-drums", "score-bass"]);
    expect(new Set(loops.map((l) => l.when)).size).toBe(1);
    expect(loops.map((l) => l.offset)).toEqual(loops.map((l) => scorePhaseOf(l.file)));
    expect(loops.every((l) => l.gains.length === 0)).toBe(true);
  });

  it("plays one random base per battle in the start mode and fades it out after", () => {
    const { player, loops } = fakePlayer();
    const rolls = [0.9, 0.1];
    const score = new CombatScore(player, () => rolls.shift() ?? 0);
    score.setCombat(true, 3);
    score.setCombat(true, 3);
    score.setCombat(false, 3);
    score.setCombat(true, 3);
    expect(loops.map((l) => l.gains)).toEqual([[start.gain], [start.gain, 0]]);
    expect(loops[1].tones).toEqual([start.cutoffHz]);
  });

  it("plays a heard accent on the active base's grid and ducks that base there", () => {
    const { player, loops, plays } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    expect(score.accent("accent-hit", 0)).toMatchObject({ cue: "accent-hit", played: true, mode: MIX.score.startMode });
    const time = loops[0].when; // the first slot at or after now + lead
    const [cue, at, delayMs] = plays[0] as [string, { gain: number }, number];
    expect([cue, at.gain]).toEqual(["accent-hit", 1]);
    expect(delayMs).toBeCloseTo((time - 2) * 1000);
    expect(loops[0].ducks[0]).toBe(time);
    expect(loops[1].ducks).toEqual([]);
  });

  type Play = [string, { gain: number }, number];
  const startTimes = (plays: unknown[][], now: (i: number) => number) => (plays as Play[]).map((p, i) => now(i) + p[2] / 1000);

  it("repeats the lead motif every repeatBeats as time passes, each repeat quieter", () => {
    const { player, plays, clock } = fakePlayer();
    const nows: number[] = [];
    const play = player.play.bind(player);
    (player as { play: unknown }).play = (...args: unknown[]) => { nows.push(clock.now); play(...(args as Parameters<typeof play>)); };
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    const s = MIX.score;
    const r = score.accent("accent-crash", 0);
    expect(r.repeats).toBe(Math.min(s.maxRepeats, Math.round(s.accents["accent-crash"].weight * s.repeatsPerHeat)));
    expect(plays).toHaveLength(1);
    for (let t = 0; t < 120; t++) {
      clock.now += 0.05;
      score.tick();
    }
    const times = startTimes(plays, (i) => nows[i]);
    expect(plays).toHaveLength(1 + r.repeats);
    expect(times[1] - times[0]).toBeCloseTo(s.repeatBeats);
    expect((plays[1] as Play)[1].gain).toBeCloseTo(s.repeatGain);
  });

  it("keeps the lead motif repeating at a steady level while paused", () => {
    const { player, plays, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    const r = score.accent("accent-crash", 0);
    score.setPaused(true);
    for (let t = 0; t < 400; t++) {
      clock.now += 0.05;
      score.tick();
    }
    expect(plays.length).toBeGreaterThan(1 + r.repeats);
    const gains = (plays as Play[]).slice(1).map((p) => p[1].gain);
    expect(new Set(gains)).toEqual(new Set([MIX.score.repeatGain]));
  });

  it("lets the newest played accent take the lead, so only one motif repeats", () => {
    const { player, plays, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    score.accent("accent-crit", 0);
    expect(score.accent("accent-hit", 900).played).toBe(true);
    for (let t = 0; t < 120; t++) {
      clock.now += 0.05;
      score.tick();
    }
    const cues = (plays as Play[]).map((p) => p[0]);
    expect(cues.slice(0, 2)).toEqual(["accent-crit", "accent-hit"]);
    expect(cues.length).toBeGreaterThan(2);
    expect(cues.slice(2).every((c) => c === "accent-hit")).toBe(true);
  });

  it("alternates accent sounds left and right", () => {
    const { player, plays } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    score.accent("accent-crit", 0);
    score.accent("accent-hit", 900);
    const pans = (plays as [string, { pan: number }][]).map((p) => p[1].pan);
    expect(pans).toEqual([-MIX.score.panSpread, MIX.score.panSpread]);
  });

  it("skips an accent when the roll misses its chance", () => {
    const { player, plays } = fakePlayer();
    const rolls = [0, 0.999];
    const score = new CombatScore(player, () => rolls.shift() ?? 0);
    score.setCombat(true, 3);
    expect(score.accent("accent-miss", 0).played).toBe(false);
    expect(plays).toEqual([]);
  });

  it("moves the base to the new mode's level and tone on a bar line", () => {
    const { player, loops, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    for (let i = 0; i < 4; i++) score.accent("accent-crash", 0);
    score.tick(); // same bar: nothing
    clock.now += 4; // next bar; roll 0 steps up
    score.tick();
    const next = MIX.score.modes.fight;
    expect(loops[0].gains.at(-1)).toBe(next.gain);
    expect(loops[0].tones.at(-1)).toBe(next.cutoffHz);
  });
});
