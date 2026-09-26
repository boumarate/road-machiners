import { describe, expect, it } from "vitest";
import { SOUNDS, type Cue } from "../data/sounds";

// Keys are paths like /public/sfx/mg-fire-1.ogg; the glob skips dotfiles.
const onDisk = Object.keys(import.meta.glob("/public/sfx/*")).map((p) => p.split("/").pop()!);

describe("sound catalog", () => {
  it("lists exactly the files in public/sfx", () => {
    const listed = Object.values(SOUNDS as Record<string, Cue>).flatMap((c) => c.files);
    expect([...listed].sort()).toEqual([...onDisk].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});
