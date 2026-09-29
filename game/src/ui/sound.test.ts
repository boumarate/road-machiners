import { describe, expect, it } from "vitest";
import { MIX } from "../data/sounds";
import { parseSettings } from "./sound";

describe("parseSettings", () => {
  it("starts from the mix volumes", () => {
    expect(parseSettings(null)).toEqual({ muted: false, volume: MIX.busVolume });
  });
  it("keeps valid stored settings", () => {
    const s = { muted: true, volume: { ui: 0, sfx: 1, ambient: 0.5, music: 0.2 } };
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
  });
  it("fails loud on invalid settings", () => {
    expect(() => parseSettings('{"muted":true}')).toThrow();
    expect(() => parseSettings('{"muted":false,"volume":{"ui":2,"sfx":1,"ambient":1,"music":1}}')).toThrow();
  });
});
