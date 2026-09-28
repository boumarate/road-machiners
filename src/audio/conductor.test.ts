import { describe, expect, it } from "vitest";
import { Conductor, Fading, type ConductorTuning } from "./conductor";

const MODE = { gain: 1, cutoffHz: 1000, boost: 1 };
const TUNING: ConductorTuning = {
  heatHalfLifeSeconds: 10,
  fatigueHalfLifeSeconds: 5,
  crowdHalfLifeSeconds: 5,
  crowdWeight: 0.5,
  modeSoftness: 0.1,
  repeatsPerHeat: 1,
  maxRepeats: 4,
  recallChance: 0.8,
  recallHalfLifeSeconds: 10,
  recallDistance: 0.5,
  startMode: "pulse",
  modes: {
    hush: { ...MODE, upAt: 0.5, downAt: -Infinity },
    pulse: { ...MODE, upAt: 2, downAt: 0.2 },
    fight: { ...MODE, boost: 2, upAt: 5, downAt: 1 },
    peak: { ...MODE, upAt: Infinity, downAt: 3 },
  },
  accents: {
    hit: { weight: 1, chance: 0.5, emphasis: 0 },
    graze: { weight: 1.4, chance: 0.5, emphasis: 0 },
    crash: { weight: 3, chance: 1, emphasis: 2 },
  },
};

describe("Fading", () => {
  it("halves every half-life and adds on top", () => {
    const f = new Fading(2);
    f.add(0, 4);
    expect(f.read(2)).toBeCloseTo(2);
    f.add(4, 1);
    expect(f.read(4)).toBeCloseTo(2);
  });
});

describe("Conductor", () => {
  it("adds heat per event, which fades over time", () => {
    const c = new Conductor(TUNING);
    expect(c.hear("crash", 0).heat).toBe(3);
    expect(c.hear("hit", 10).heat).toBeCloseTo(2.5);
  });

  it("lowers the chance after the accent's own plays, and recovers as they fade", () => {
    const c = new Conductor(TUNING);
    expect(c.hear("hit", 0).chance).toBe(0.5);
    c.played("hit", 0);
    const tired = c.hear("hit", 0).chance;
    expect(tired).toBeLessThan(0.5 * Math.exp(-1) + 1e-9);
    expect(c.hear("hit", 60).chance).toBeCloseTo(0.5);
  });

  it("lowers every accent's chance while the music is crowded", () => {
    const c = new Conductor(TUNING);
    c.played("hit", 0);
    expect(c.hear("crash", 0).chance).toBeCloseTo(Math.exp(-0.5));
  });

  it("steps up one mode per bar when heat is high, never skipping one", () => {
    const c = new Conductor(TUNING);
    c.hear("crash", 0);
    c.hear("crash", 0);
    expect(c.bar(0, 0.5)).toBe("fight");
    expect(c.bar(0, 0.5)).toBe("peak");
    expect(c.bar(0, 0.01)).toBe("peak");
  });

  it("scales the chance by the mode's boost, capped at 1", () => {
    const c = new Conductor(TUNING);
    c.hear("crash", 0);
    c.bar(0, 0.5);
    expect(c.mode()).toBe("fight");
    expect(c.hear("hit", 0).chance).toBe(1);
  });

  it("steps down as heat fades and stays when heat sits between the thresholds", () => {
    const c = new Conductor(TUNING);
    c.hear("hit", 0);
    expect(c.bar(0, 0.5)).toBe("pulse");
    expect(c.bar(100, 0.99)).toBe("hush");
    c.begin();
    expect(c.mode()).toBe("pulse");
  });

  it("repeats a played accent more the hotter the fight, up to the cap", () => {
    const c = new Conductor(TUNING);
    expect(c.repeats(0)).toBe(0);
    c.hear("crash", 0);
    expect(c.repeats(0)).toBe(3);
    c.hear("crash", 0);
    expect(c.repeats(0)).toBe(4);
    expect(c.repeats(100)).toBe(0);
  });

  it("recalls the last played accent for an event of close weight, with a chance that fades", () => {
    const c = new Conductor<string>(TUNING);
    expect(c.recall("graze", 0, 0)).toBe("graze");
    c.played("hit", 0);
    expect(c.recall("graze", 0, 0.79)).toBe("hit");
    expect(c.recall("graze", 0, 0.81)).toBe("graze");
    expect(c.recall("graze", 10, 0.39)).toBe("hit");
    expect(c.recall("graze", 10, 0.41)).toBe("graze");
  });

  it("never recalls across a large weight gap", () => {
    const c = new Conductor<string>(TUNING);
    c.played("hit", 0);
    expect(c.recall("crash", 0, 0)).toBe("crash");
  });

  it("fails loud on an accent it has no tuning for", () => {
    expect(() => new Conductor(TUNING).hear("nope", 0)).toThrow("no tuning");
  });
});
