import { describe, expect, it } from "vitest";
import { Fading, SoundDesigner, type AccentPlan, type DesignerTuning } from "./designer";

// One beat per second, four beats per bar, two slots per beat: slots every half second, bars at 0, 4, 8.
const GRID = { start: 0, beat: 1, beatsPerBar: 4 };
const TUNING: DesignerTuning = {
  subdivision: 2,
  humanizeMs: 0,
  gainJitter: 0,
  hotHeat: 5,
  pauseRepeats: 2,
  fillChance: 0,
  fillGain: 0.5,
  secondaryPan: 0.3,
  busyFactor: 0,
  lines: {
    lead: { gain: 1, queueMax: 2, calm: ["x...x..."], hot: ["xxxxxxxx"] },
    secondary: { gain: 0.5, queueMax: 2, calm: ["..x...x."], hot: [".x.x.x.x"] },
  },
};
const LEAD: AccentPlan = { line: "lead", weight: 0.5, bars: 1, chance: 1, urgent: false };
const HEAVY: AccentPlan = { ...LEAD, weight: 1 };
const CRASH: AccentPlan = { ...LEAD, weight: 1, bars: 2, urgent: true };
const LIGHT: AccentPlan = { line: "secondary", weight: 0.2, bars: 1, chance: 1, urgent: false };

function designer(tuning = TUNING, roll = () => 0): SoundDesigner {
  return new SoundDesigner(GRID, tuning, roll, 0.1);
}

const times = (hits: { time: number }[]) => hits.map((h) => h.time);

describe("SoundDesigner", () => {
  it("starts a lead phrase on the next bar line and plays its rhythm", () => {
    const d = designer();
    d.offer("a", LEAD, 0.1);
    expect(times(d.step(0.1, 7.9, false, 0))).toEqual([4, 6]);
  });

  it("plays the secondary on weak beats, to one side and quieter", () => {
    const d = designer();
    d.offer("b", LIGHT, 0);
    const hits = d.step(0.1, 7.9, false, 0);
    expect(times(hits)).toEqual([5, 7]);
    expect(hits.map((h) => [h.pan, h.gain])).toEqual([[-0.3, 0.5], [-0.3, 0.5]]);
  });

  it("plays queued phrases one after another", () => {
    const d = designer();
    d.offer("a", LEAD, 0);
    d.offer("c", LEAD, 0);
    const hits = d.step(0.1, 11.9, false, 0);
    expect(hits.map((h) => `${h.cue}@${h.time}`)).toEqual(["a@4", "a@6", "c@8", "c@10"]);
  });

  it("merges a repeat event into its waiting phrase, which then takes a dense rhythm", () => {
    const d = designer();
    expect(d.offer("a", LEAD, 0)).toBe("queued");
    expect(d.offer("a", LEAD, 0)).toBe("merged");
    expect(d.step(0.1, 7.9, false, 0)).toHaveLength(8);
  });

  it("takes dense rhythms once the fight is hot", () => {
    const d = designer();
    d.offer("a", LEAD, 0);
    expect(d.step(0.1, 7.9, false, 5)).toHaveLength(8);
  });

  it("drops an event when the queue is full of phrases as heavy, and lets a heavier one replace the lightest", () => {
    const d = designer();
    d.offer("a", LEAD, 0);
    d.offer("c", LEAD, 0);
    expect(d.offer("d", LEAD, 0)).toBe("dropped");
    expect(d.offer("e", HEAVY, 0)).toBe("replaced");
    expect(new Set(d.step(0.1, 11.9, false, 0).map((h) => h.cue))).toEqual(new Set(["c", "e"]));
  });

  it("cuts an urgent phrase in on the next beat", () => {
    const d = designer();
    d.offer("a", LEAD, 0);
    d.step(0.1, 4.9, false, 0);
    d.offer("crash", CRASH, 4.6);
    expect(d.step(4.6, 5.1, false, 0).map((h) => `${h.cue}@${h.time}`)).toEqual(["crash@5"]);
  });

  it("does not start a phrase before its event's time", () => {
    const d = designer();
    d.offer("a", LEAD, 5);
    expect(times(d.step(0.1, 11.9, false, 0))).toEqual([8, 10]);
  });

  it("repeats the last lead phrase pauseRepeats times in a pause, then rests", () => {
    const d = designer();
    d.offer("a", LEAD, 0);
    expect(times(d.step(0.1, 30, true, 0))).toEqual([4, 6, 8, 10, 12, 14]);
  });

  it("rests after a phrase when not paused", () => {
    const d = designer();
    d.offer("a", LEAD, 0);
    expect(times(d.step(0.1, 30, false, 0))).toEqual([4, 6]);
  });

  it("always offers a lead event, however busy the lead is", () => {
    const d = designer({ ...TUNING, busyFactor: 10 }, () => 0.99);
    d.offer("a", LEAD, 0);
    expect(d.offer("c", LEAD, 0)).toBe("queued");
  });

  it("lets a light event join by chance, lower on a busy line", () => {
    const tuning = { ...TUNING, busyFactor: 1 };
    const d = designer(tuning, () => 0.5);
    expect(d.offer("b", { ...LIGHT, chance: 0.6 }, 0)).toBe("queued");
    expect(d.offer("c", { ...LIGHT, chance: 0.6 }, 0)).toBe("skipped");
  });

  it("adds a fill on the last slot of a lead phrase by chance", () => {
    const d = designer({ ...TUNING, fillChance: 1 });
    d.offer("a", LEAD, 0);
    const hits = d.step(0.1, 7.9, false, 0);
    expect(times(hits)).toEqual([4, 6, 7.5]);
    expect(hits[2].gain).toBe(0.5);
  });

  it("fails loud on a rhythm of the wrong length", () => {
    const bad = { ...TUNING, lines: { ...TUNING.lines, lead: { ...TUNING.lines.lead, calm: ["x..."] } } };
    expect(() => designer(bad)).toThrow("Bad lead rhythm");
  });
});

describe("Fading", () => {
  it("halves every half-life and adds on top", () => {
    const f = new Fading(2);
    f.add(0, 4);
    expect(f.read(2)).toBeCloseTo(2);
    f.add(4, 1);
    expect(f.read(4)).toBeCloseTo(2);
  });
});
