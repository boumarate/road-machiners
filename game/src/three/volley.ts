import { CONFIG } from "../config";
import { PAL } from "../render/palette";
import type { ShotRound, World } from "../sim/types";
import { roundLabel } from "../ui/format";
import { groundPoint, toMap, type V3 } from "../phys/frames";
import type { Fx3D } from "./render/fx";
import { blastRadiusOf, planVolley, projectileOf, roundAims, type Muzzle } from "./render/projectiles";
import type { SoundDirector } from "./sound";

// What a volley draws on: the world it lands in, the effects and sounds it plays, and where an event's truck is seen.
export type VolleyHost = {
  world: World;
  fx: Fx3D;
  sound: SoundDirector;
  eventPoint: (vehicleId: string) => V3 | null;
};

// Plays one volley's bolts from the muzzle and sounds from a to b. Each round that damages parts shows its
// damage over the target as it lands. Returns when the first round lands.
export function playVolley(
  host: VolleyHost,
  a: V3,
  muzzle: () => Muzzle,
  b: V3,
  rounds: ShotRound[],
  weapon: string,
  targetId: string,
  rows: Map<string, number>,
): number {
  // Every round lands within the shot time, before the results show.
  const spec = projectileOf(weapon);
  const ground = (p: V3) => groundPoint(host.world.terrain, toMap(p)).y;
  const plans = planVolley(spec, a, roundAims(b, targetId, rounds, host.eventPoint), CONFIG.combatShotMs, ground);
  plans.forEach((plan, k) => {
    host.fx.shot(spec, muzzle, plan, blastRadiusOf(weapon));
    host.sound.at(spec.look === "tracer" ? "mg-fire" : "cannon-fire", a, plan.delayMs);
    host.sound.at(plan.struck ? "hit-metal" : "miss", plan.land, plan.delayMs + plan.flightMs);
    const r = rounds[k];
    const struck = r.struck === null ? [] : [{ vehicle: r.struck, hits: r.hits }];
    const landMs = plan.delayMs + plan.flightMs;
    for (const dealt of [...struck, ...r.blast]) damageLabel(host, dealt.vehicle, roundLabel(host.world, dealt.vehicle, dealt.hits, r.crit), rows, landMs);
  });
  return Math.min(...plans.map((plan) => plan.delayMs + plan.flightMs));
}

// Damage text over a truck that shows, stacked in rows per truck.
function damageLabel(host: VolleyHost, vehicleId: string, label: string | null, rows: Map<string, number>, atMs: number): void {
  const p = host.eventPoint(vehicleId);
  if (!label || !p) return;
  const row = rows.get(vehicleId) ?? 0;
  rows.set(vehicleId, row + 1);
  host.fx.label(p, label, PAL.damageText, row, atMs, CONFIG.combatReadMs);
}
