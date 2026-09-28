import { describe, expect, it } from "vitest";
import { SoundDesigner, type ScoreTiming } from "./designer";

// One beat per second with two slots per beat: slots every half second from time 10.
const GRID = { start: 10, beat: 1 };
const TIMING: ScoreTiming = { subdivision: 2, spreadSlots: 2, humanizeMs: 20, repeatSeconds: 4, repeatGain: 0.5, repeatMax: 2 };

function designer(): SoundDesigner {
  return new SoundDesigner(GRID, TIMING);
}

describe("SoundDesigner", () => {
  it("lands up to spreadSlots before or after the wanted slot", () => {
    expect(designer().schedule("hit", 12, 0, 0)).toEqual({ time: 11, gain: 1 });
    expect(designer().schedule("hit", 12, 0, 0.999)?.time).toBeCloseTo(13.02, 2);
  });

  it("never lands before the earliest time", () => {
    expect(designer().schedule("hit", 12, 11.9, 0)?.time).toBe(12);
  });

  it("uses what the slot pick leaves of the roll as the humanize delay", () => {
    // Five free slots: 0.1 picks the first with half of it left, 10 ms.
    expect(designer().schedule("hit", 12, 0, 0.1)?.time).toBeCloseTo(11.01);
  });

  it("skips taken slots", () => {
    const d = designer();
    d.schedule("hit", 12, 0, 0);
    expect(d.schedule("miss", 12, 0, 0)?.time).toBe(11.5);
  });

  it("drops an accent when every slot in the window is taken", () => {
    const d = designer();
    for (const id of ["a", "b", "c", "d", "e"]) d.schedule(id, 12, 0, 0);
    expect(d.schedule("f", 12, 0, 0)).toBeNull();
  });

  it("keeps a slot taken after a request for a later time", () => {
    const d = designer();
    d.schedule("hit", 13, 0, 0);
    d.schedule("miss", 16, 0, 0);
    expect(d.schedule("crit", 13, 0, 0)?.time).toBe(12.5);
  });

  it("quiets each repeat inside the window and drops repeats past the limit", () => {
    const d = designer();
    const gains = [12, 13, 14, 15].map((t) => d.schedule("hit", t, 0, 0)?.gain ?? null);
    expect(gains).toEqual([1, 0.5, 0.25, null]);
  });

  it("plays at full gain again once the window has passed", () => {
    const d = designer();
    d.schedule("hit", 12, 0, 0);
    d.schedule("hit", 13, 0, 0);
    expect(d.schedule("hit", 20, 0, 0)?.gain).toBe(1);
  });

  it("does not penalize a different accent", () => {
    const d = designer();
    d.schedule("hit", 12, 0, 0);
    expect(d.schedule("miss", 13, 0, 0)?.gain).toBe(1);
  });
});
