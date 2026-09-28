import { describe, expect, it } from "vitest";
import { SoundDesigner, type ScoreTiming } from "./designer";

// One beat per second with two slots per beat: slots every half second from time 10.
const GRID = { start: 10, beat: 1 };
const TIMING: ScoreTiming = { subdivision: 2, maxSlotShift: 2, humanizeMs: 20, repeatSeconds: 4, repeatGain: 0.5, repeatMax: 2 };

function designer(): SoundDesigner {
  return new SoundDesigner(GRID, TIMING);
}

describe("SoundDesigner", () => {
  it("snaps an accent forward to the next slot", () => {
    expect(designer().schedule("hit", 11.1, 0)).toEqual({ time: 11.5, gain: 1 });
  });

  it("keeps an accent that lands on a slot", () => {
    expect(designer().schedule("hit", 12, 0)).toEqual({ time: 12, gain: 1 });
  });

  it("adds a humanize delay under the limit", () => {
    const play = designer().schedule("hit", 12, 0.5);
    expect(play?.time).toBeCloseTo(12.01);
  });

  it("moves a second accent off a taken slot", () => {
    const d = designer();
    d.schedule("hit", 12, 0);
    expect(d.schedule("miss", 12, 0)?.time).toBe(12.5);
  });

  it("drops an accent when every slot within reach is taken", () => {
    const d = designer();
    for (const id of ["a", "b", "c"]) d.schedule(id, 12, 0);
    expect(d.schedule("d", 12, 0)).toBeNull();
  });

  it("keeps a slot taken after a request for a later time", () => {
    const d = designer();
    d.schedule("hit", 13, 0);
    d.schedule("miss", 14, 0);
    expect(d.schedule("crit", 13, 0)?.time).toBe(13.5);
  });

  it("quiets each repeat inside the window and drops repeats past the limit", () => {
    const d = designer();
    const gains = [12, 13, 14, 15].map((t) => d.schedule("hit", t, 0)?.gain ?? null);
    expect(gains).toEqual([1, 0.5, 0.25, null]);
  });

  it("plays at full gain again once the window has passed", () => {
    const d = designer();
    d.schedule("hit", 12, 0);
    d.schedule("hit", 13, 0);
    expect(d.schedule("hit", 17.5, 0)?.gain).toBe(1);
  });

  it("does not penalize a different accent", () => {
    const d = designer();
    d.schedule("hit", 12, 0);
    expect(d.schedule("miss", 13, 0)?.gain).toBe(1);
  });
});
