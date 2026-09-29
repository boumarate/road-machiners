import { describe, expect, it } from "vitest";
import { playerVehicle } from "../sim/damage";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import { refreshVision } from "../sim/vision";
import { startPose } from "../sim/world";
import { doneTips, tipToShow, type TipId } from "./tips";

describe("driving tips", () => {
  it("walks the player from a waypoint to Space, stopping, stop waypoints and manual mode", () => {
    const w = emptyWorld();
    const me = playerVehicle(w);
    const seen = new Set<TipId>();
    expect(tipToShow(w, false, seen, null)).toBe("waypoint");

    me.order = { kind: "stopAt", dest: { x: 40, y: 30 } };
    expect(doneTips(w)).toContain("waypoint");
    seen.add("waypoint");
    expect(tipToShow(w, false, seen, null)).toBe("drive");

    me.speed = 2;
    seen.add("drive");
    expect(tipToShow(w, true, seen, null)).toBe("autoStop");

    seen.add("autoStop");
    expect(tipToShow(w, false, seen, null)).toBe("stop");

    me.speed = 0;
    me.order = { kind: "brake" };
    seen.add("stop");
    expect(tipToShow(w, false, seen, null)).toBe("stopAt");

    me.order = { kind: "stopAt", dest: { x: 40, y: 30 } };
    expect(doneTips(w)).toContain("stopAt");
    seen.add("stopAt");
    expect(tipToShow(w, false, seen, null)).toBe("manual");

    me.direct = true;
    seen.add("manual");
    expect(tipToShow(w, false, seen, null)).toBe("zones");
  });

  it("holds a later driving tip until the one before it is seen", () => {
    const w = emptyWorld();
    playerVehicle(w).speed = 2;
    expect(tipToShow(w, false, new Set(), null)).toBe("waypoint");
  });

  it("marks tips done by what the player did", () => {
    const w = emptyWorld();
    const me = playerVehicle(w);
    me.order = { kind: "brake" };
    me.direct = true;
    w.events.push({ t: "honk", vehicle: me.id });
    expect(doneTips(w).sort()).toEqual(["honk", "manual", "stop"]);
  });

  it("shows no tip to a player who cannot act", () => {
    const w = emptyWorld();
    w.player.state = "dead";
    expect(tipToShow(w, false, new Set(), null)).toBeNull();
  });
});

describe("horn tip", () => {
  it("shows once an NPC is in sight and keeps a shown tip in place", () => {
    const w = emptyWorld();
    const seen = new Set<TipId>(["waypoint", "drive", "stop", "stopAt", "manual"]);
    expect(tipToShow(w, false, seen, null)).toBeNull();

    const npc = addVehicle(w, "scavengers", "scout", [], { x: 32, y: 30 });
    npc.brain = npcBrain("scavenger", npc.pos, ["scavenger"]);
    refreshVision(w);
    expect(tipToShow(w, false, seen, null)).toBe("honk");

    const driving = new Set<TipId>();
    expect(tipToShow(w, false, driving, "waypoint")).toBe("waypoint");
  });

  it("ignores an NPC out of sight", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "scavengers", "scout", [], { x: 58, y: 58 });
    npc.brain = npcBrain("scavenger", npc.pos, ["scavenger"]);
    refreshVision(w);
    expect(tipToShow(w, false, new Set(["waypoint"]), null)).toBeNull();
  });
});

describe("farewell tip", () => {
  const allButFarewell: TipId[] = ["waypoint", "drive", "autoStop", "stop", "stopAt", "manual", "zones", "honk"];

  it("shows once the player drives well past where traders first show up", () => {
    const w = emptyWorld();
    const spawn = startPose().pos;
    playerVehicle(w).pos = { x: spawn.x + 60, y: spawn.y };
    expect(tipToShow(w, false, new Set(allButFarewell), null)).toBeNull();
    playerVehicle(w).pos = { x: spawn.x + 80, y: spawn.y };
    expect(tipToShow(w, false, new Set(allButFarewell), null)).toBe("farewell");
  });

  it("waits for the horn tip", () => {
    const w = emptyWorld();
    const spawn = startPose().pos;
    playerVehicle(w).pos = { x: spawn.x + 80, y: spawn.y };
    expect(tipToShow(w, false, new Set(allButFarewell.filter((id) => id !== "honk")), null)).toBeNull();
  });
});
