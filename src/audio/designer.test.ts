import { describe, expect, it } from "vitest";
import { SoundDesigner, type SlotTiming } from "./designer";

// One beat per second, four beats per bar, two slots per beat: slots every half second from time 10,
// bars starting at 10, 14, 18.
const GRID = { start: 10, beat: 1, beatsPerBar: 4 };
const TIMING: SlotTiming = { subdivision: 2, spreadSlots: 2, humanizeMs: 20 };

function designer(): SoundDesigner {
  return new SoundDesigner(GRID, TIMING);
}

describe("SoundDesigner", () => {
  it("lands up to spreadSlots before or after the wanted slot", () => {
    expect(designer().schedule(12, 0, 0, 0)).toBe(11);
    expect(designer().schedule(12, 0, 0, 0.999)).toBeCloseTo(13.02, 2);
  });

  it("never lands before the earliest time", () => {
    expect(designer().schedule(12, 11.9, 0, 0)).toBe(12);
  });

  it("pulls a strong accent onto the bar's first beat", () => {
    // Slots 13 to 15: weights 2^8, 1, 4^8, 1, 2^8. A middle roll falls on the downbeat at 14, halfway into it.
    expect(designer().schedule(14, 0, 8, 0.5)).toBeCloseTo(14.01);
  });

  it("pushes a weak accent off the beat", () => {
    // Negative emphasis: the off-beats at 13.5 and 14.5 hold almost all the weight.
    const t = designer().schedule(14, 0, -8, 0.25)!;
    expect(Math.round(t * 2) / 2).toBe(13.5);
  });

  it("skips taken slots", () => {
    const d = designer();
    d.schedule(12, 0, 0, 0);
    expect(d.schedule(12, 0, 0, 0)).toBe(11.5);
  });

  it("drops an accent when every slot in the window is taken", () => {
    const d = designer();
    for (let i = 0; i < 5; i++) d.schedule(12, 0, 0, 0);
    expect(d.schedule(12, 0, 0, 0)).toBeNull();
  });

  it("claims a free slot for a repeat and refuses a taken one", () => {
    const d = designer();
    expect(d.schedule(12, 0, 0, 0)).toBe(11);
    expect(d.claim(11)).toBe(false);
    expect(d.claim(12)).toBe(true);
    expect(d.claim(12)).toBe(false);
  });

  it("keeps a slot taken after a request for a later time", () => {
    const d = designer();
    d.schedule(13, 0, 0, 0);
    d.schedule(16, 0, 0, 0);
    expect(d.schedule(13, 0, 0, 0)).toBe(12.5);
  });
});
