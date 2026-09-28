// First-time tips for driving and the horn. A tip shows while its moment lasts, one at a time. It goes away for good
// once the player closes it or does what it says. Seen tips stay in browser storage across saves and new games.

import { isKnockedOut } from "../sim/defeat";
import { playerVehicle } from "../sim/damage";
import type { World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { playerCanAct } from "../sim/world";
import { el, panel } from "./dom";

const TIPS_KEY = "roam.tips";

export type TipId = "waypoint" | "drive" | "stop" | "manual" | "zones" | "honk";

type Tip = {
  id: TipId;
  text: string;
  after?: TipId; // shows only once this tip is seen
  when: (w: World) => boolean;
  done: (w: World) => boolean;
};

const npcInSight = (w: World): boolean =>
  w.vehicles.some((v) => v.brain && !isKnockedOut(v) && playerSees(w, v.pos));

// List order is priority when two tips could show at once.
const TIPS: readonly Tip[] = [
  {
    id: "waypoint",
    text: "Click the ground to set a waypoint.",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => ["through", "stop"].includes(playerVehicle(w).order?.kind ?? ""),
  },
  {
    id: "drive",
    text: "[Space] to drive to the waypoint.",
    after: "waypoint",
    when: (w) => !playerVehicle(w).direct && ["through", "stop"].includes(playerVehicle(w).order?.kind ?? ""),
    done: (w) => playerVehicle(w).speed > 0,
  },
  {
    id: "stop",
    text: "Click your truck to stop.",
    after: "drive",
    when: (w) => playerVehicle(w).speed > 0,
    done: (w) => playerVehicle(w).order?.kind === "brake",
  },
  {
    id: "manual",
    text: "[R] to drive in manual mode.",
    after: "stop",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => playerVehicle(w).direct,
  },
  {
    id: "zones",
    text: "Manual mode: click a zone to drive. Green speeds up. Yellow holds speed. Red slows down.",
    when: (w) => playerVehicle(w).direct,
    done: () => false,
  },
  {
    id: "honk",
    text: "[H] to honk.",
    when: npcInSight,
    done: (w) => w.events.some((e) => e.t === "honk" && e.vehicle === w.player.vehicleId),
  },
];

// Tips the player has just done, whether or not they were on screen.
export function doneTips(world: World): TipId[] {
  return TIPS.filter((t) => t.done(world)).map((t) => t.id);
}

// The tip to show now. The shown tip keeps its place while its moment lasts, so a new tip never swaps it out.
export function tipToShow(world: World, seen: ReadonlySet<TipId>, shown: TipId | null): TipId | null {
  if (!playerCanAct(world)) return null;
  const open = TIPS.filter((t) => !seen.has(t.id) && (!t.after || seen.has(t.after)) && t.when(world));
  return (open.find((t) => t.id === shown) ?? open[0])?.id ?? null;
}

function readSeen(storage: Storage): Set<TipId> {
  const raw = storage.getItem(TIPS_KEY);
  if (raw === null) return new Set();
  const ids: unknown = JSON.parse(raw);
  const known = new Set<string>(TIPS.map((t) => t.id));
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && known.has(id)))
    throw new Error(`Stored tips are not a list of tip ids: ${raw}`);
  return new Set(ids as TipId[]);
}

export class Tips {
  private readonly box = panel("tip");
  private readonly seen: Set<TipId>;
  private shown: TipId | null = null;
  private world: World | null = null;

  constructor(private readonly storage: Storage) {
    this.seen = readSeen(storage);
    this.box.style.display = "none";
  }

  update(world: World): void {
    this.world = world;
    for (const id of doneTips(world)) this.markSeen(id);
    const next = tipToShow(world, this.seen, this.shown);
    if (next === this.shown) return;
    this.shown = next;
    this.render();
  }

  private markSeen(id: TipId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.storage.setItem(TIPS_KEY, JSON.stringify([...this.seen]));
  }

  private close(): void {
    if (!this.shown || !this.world) throw new Error("Closed a tip that was never shown");
    this.markSeen(this.shown);
    this.shown = null;
    this.render();
    this.update(this.world);
  }

  private render(): void {
    const tip = TIPS.find((t) => t.id === this.shown);
    this.box.style.display = tip ? "" : "none";
    if (!tip) return;
    this.box.replaceChildren(
      el("span", {}, tip.text),
      el("button", { class: "tip-close", title: "Close", onclick: () => this.close() }, "×"),
    );
  }
}
