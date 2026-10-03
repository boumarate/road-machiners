// The claymore ram: arming it, its blast in a hard truck crash on its side, and disarming it once it breaks or
// leaves its mount. utility.ts hands it the arming order and crash-contact.ts each truck crash. The charge state and
// the reload belong to utility.ts.

import { partDef, type ClaymoreDef } from '../data/parts';
import { coversSide, lanePoint, walkLane, type Round } from './armor';
import { blastTruck, isHostile, noteAttack } from './combat';
import type { CrashContact } from './crash-contact';
import { isMounted, mountedParts } from './grid';
import type { PartInstance, Vehicle, World } from './types';
import type { Vec } from './vec';
import { chargeOf, wornReload } from './utility';

// One truck's view of a crash with another truck: the closing speed in tiles per turn, its own touched side and
// lanes, and the other truck's.
export type ClaymoreCrash = { impact: number; own: CrashContact; theirs: CrashContact };

function claymoreOf(part: PartInstance): ClaymoreDef {
  const def = partDef(part.defId);
  if (def.kind !== 'armor' || !def.claymore) throw new Error(`${def.name} is not a claymore ram`);
  return def.claymore;
}

// Arms a working, ready claymore ram. Arming is not hostile. utility.ts refuses the order first, so a part that
// cannot be armed here is a bug.
export function armClaymore(v: Vehicle, part: PartInstance): void {
  claymoreOf(part);
  const charge = chargeOf(part);
  if (charge.armed || charge.reload > 0 || part.hp <= 0) throw new Error(`${v.name} cannot arm claymore ram ${part.id}`);
  charge.armed = true;
}

// A claymore ram that is moved or stored loses its charge. Any other part is unchanged.
export function disarm(part: PartInstance): void {
  delete part.charge?.armed;
}

// Each armed, working claymore ram on the user's struck side blasts when the crash is hard enough. Slower crashes
// and crashes on other sides leave it armed.
export function detonateOnCrash(world: World, user: Vehicle, other: Vehicle, crash: ClaymoreCrash): void {
  for (const part of armedOn(user, crash)) if (crash.impact >= claymoreOf(part).minImpact) detonate(world, user, other, part, crash);
}

function armedOn(v: Vehicle, crash: ClaymoreCrash): PartInstance[] {
  return mountedParts(v, 'armor').filter((p) => p.charge?.armed && p.hp > 0 && coversSide(v, p, crash.own.side));
}

// The blast hits the other truck around the contact point and the user's struck lanes, where the ram soaks first.
// The blast on the other truck is the user's attack and carries kill credit. The self damage is owned by nobody.
function detonate(world: World, user: Vehicle, other: Vehicle, part: PartInstance, crash: ClaymoreCrash): void {
  const c = claymoreOf(part);
  const charge = chargeOf(part);
  delete charge.armed;
  charge.reload = wornReload(part);
  const calm = !isHostile(world, other, user);
  const pos = contactPoint(other, crash.theirs);
  const hits = blastTruck(world, other, pos, c.blast.radius, blastRound(c.blast), null);
  const selfHits = crash.own.lanes.flatMap((lane) => walkLane(world, user, crash.own.side, lane, blastRound(c.selfBlast)));
  if (hits.length > 0) other.lastHitBy = user.id;
  noteAttack(world, user, other, calm);
  world.events.push({ t: 'claymore', vehicle: user.id, other: other.id, pos, hits, selfHits });
}

function blastRound(b: { damage: number; pen: number }): Round {
  return { damage: b.damage, pen: b.pen, blast: true, armorShare: 1 };
}

// Where the crash touched the other truck: the middle of its touched lanes on its struck side, at its pose now.
// Physics reports the contact as sides and lanes only.
function contactPoint(v: Vehicle, contact: CrashContact): Vec {
  if (contact.lanes.length === 0) throw new Error('Crash has no touched lanes');
  return lanePoint(v, contact.side, (Math.min(...contact.lanes) + Math.max(...contact.lanes)) / 2);
}

// Once per turn after all damage: a claymore ram that broke or left its mount loses its charge, on a truck, in the
// player's storage or in a salvage stock. Parts leave trucks in many places, so this sweep is the one place that
// disarms them.
export function settleClaymores(world: World): void {
  for (const part of [...world.vehicles.flatMap(unfitClaymores), ...looseParts(world)]) disarm(part);
}

// The truck's armed claymore rams that are broken or off their mount.
function unfitClaymores(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' && it.part.charge?.armed && (it.part.hp <= 0 || !isMounted(v.chassisId, it)) ? [it.part] : []));
}

// Parts off every truck: the player's storage and the salvage stocks, revealed or hidden.
function looseParts(world: World): PartInstance[] {
  return [...world.player.storage, ...world.salvage.flatMap((s) => [...s.parts, ...s.hidden.parts])];
}
