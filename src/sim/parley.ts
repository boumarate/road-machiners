// Ending or dodging a fight by talk. A truce ends the feuds between two sides for a while. Mercy is a truce the
// loser buys with its cargo. A threat asks a driver at peace for its cargo. An NPC answers each with a weighted
// decision. Radio talk with the player lives in src/sim/dialogue.ts, and this module owns what the answers do.

import { SPAWN } from '../data/npcs';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { partSellPrice } from './economy';
import { corePart, isMounted } from './grid';
import { applyRefitLayout } from './inventory';
import { creditBounty } from './market';
import { defyThreat, pushGoal, topGoal } from './npc-activities';
import { decide, perceiveDanger, visibleHostiles, wantsLoot } from './npc-decisions';
import { vehicleHasPerk } from './progress';
import { createCargoSalvage, dumpOnPile, hasCargo, takeError } from './salvage';
import { isStranded } from './stats';
import { addState, endState, pleaData, stateOf } from './states';
import type { DecisionOptions } from '../data/npcs';
import type { Aim, GridItem, Plea, SalvageStock, Vehicle, World } from './types';
import { dist } from './vec';

export type ThreatAnswer = DecisionOptions['threatened'];

// A vehicle and its NPC faction mates within SPAWN.neighborHelp. The player stands alone.
function sideOf(world: World, v: Vehicle): Vehicle[] {
  if (!v.brain) return [v];
  return world.vehicles.filter((x) => x.id === v.id || (x.brain && x.faction === v.faction && dist(x.pos, v.pos) <= SPAWN.neighborHelp));
}

// Every feud between the two sides ends, and each pair holds a truce both ways. Nobody on either side keeps aiming at the
// other side.
export function makePeace(world: World, a: Vehicle, b: Vehicle): void {
  for (const p of sideOf(world, a)) {
    for (const q of sideOf(world, b)) {
      if (p.id === q.id) continue;
      for (const s of [stateOf(world, 'feud', p.id, q.id), stateOf(world, 'feud', q.id, p.id)]) if (s) endState(world, s, 'broken');
      addState(world, 'truce', p.id, q.id, { kind: 'none' });
      addState(world, 'truce', q.id, p.id, { kind: 'none' });
      holdFire(p, q);
      holdFire(q, p);
    }
  }
}

function holdFire(v: Vehicle, target: Vehicle): void {
  for (const [id, order] of Object.entries(v.weaponOrders)) if (order.targetId === target.id) delete v.weaponOrders[id];
  if (v.brain) delete v.brain.attackers[target.id];
}

// The loser drops its cargo beside its truck, and both sides make peace. An NPC winner goes to take the cargo, and its grudge against the loser is settled.
// `dumped` is the pile the loser already threw parts onto.
export function yieldTo(world: World, loser: Vehicle, winner: Vehicle, dumped: SalvageStock | null = null): void {
  const stock = hasCargo(loser) ? createCargoSalvage(world, loser, 1) : dumped;
  makePeace(world, loser, winner);
  const grudge = stateOf(world, 'revenge', winner.id, loser.id);
  if (grudge) endState(world, grudge, 'fulfilled');
  if (stock && winner.brain) pushGoal(world, winner, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'take the handed-over cargo' });
  creditYield(world, loser, winner);
}

// A stranded player gives up to a robber: the cargo and the best installed parts go onto the ground, and the truck stays.
export function surrenderTo(world: World, me: Vehicle, robber: Vehicle): void {
  yieldTo(world, me, robber, dumpWantedParts(world, me));
}

// With Bounty talk, an NPC that gives up to the player counts for a bounty on its template.
function creditYield(world: World, loser: Vehicle, winner: Vehicle): void {
  if (loser.brain && vehicleHasPerk(world, winner, 'bountyTalk')) creditBounty(world, loser);
}

// An NPC's answer to a plea, rolled once.
export function answersPlea(world: World, answerer: Vehicle, pleader: Vehicle, plea: Plea): boolean {
  const danger = perceiveDanger(world, answerer, pleader);
  if (plea === 'truce') return decide(world, answerer, 'truceOffered', pleader.id, danger) === 'accept';
  return decide(world, answerer, 'mercyBegged', pleader.id, danger) === 'spare';
}

function grantPlea(world: World, pleader: Vehicle, answerer: Vehicle, plea: Plea): void {
  if (plea === 'truce') makePeace(world, pleader, answerer);
  else yieldTo(world, pleader, answerer);
}

// An NPC pleads with a foe. Another NPC answers at once. The player answers when the NPC calls.
export function plead(world: World, npc: Vehicle, foe: Vehicle, plea: Plea): void {
  addState(world, 'plea', npc.id, foe.id, { kind: 'plea', plea, answered: foe.brain !== null });
  if (!foe.brain) {
    world.events.push({ t: 'plea', from: npc.id, to: foe.id, plea, accepted: null });
    return;
  }
  const accepted = answersPlea(world, foe, npc, plea);
  world.events.push({ t: 'plea', from: npc.id, to: foe.id, plea, accepted });
  if (accepted) grantPlea(world, npc, foe, plea);
}

// The player pleads with an NPC, which answered with `accepted`.
export function settlePlayerPlea(world: World, npc: Vehicle, plea: Plea, accepted: boolean): void {
  const me = playerVehicle(world);
  addState(world, 'plea', me.id, npc.id, { kind: 'plea', plea, answered: true });
  world.events.push({ t: 'plea', from: me.id, to: npc.id, plea, accepted });
  if (accepted) grantPlea(world, me, npc, plea);
}

// The plea this NPC made to the player that waits for an answer, or null.
export function pendingPlea(world: World, npc: Vehicle): Plea | null {
  const s = stateOf(world, 'plea', npc.id, world.player.vehicleId);
  if (!s || pleaData(s).answered) return null;
  return pleaData(s).plea;
}

// The player answers the NPC's waiting plea.
export function answerPlea(world: World, npc: Vehicle, accepted: boolean): void {
  const s = stateOf(world, 'plea', npc.id, world.player.vehicleId);
  if (!s || pleaData(s).answered) throw new Error(`${npc.id} has no plea waiting for the player`);
  const data = pleaData(s);
  data.answered = true;
  world.events.push({ t: 'plea', from: npc.id, to: world.player.vehicleId, plea: data.plea, accepted });
  if (accepted) grantPlea(world, npc, playerVehicle(world), data.plea);
}

// Whether the player pleaded with this NPC recently.
export function playerPleaded(world: World, npc: Vehicle): boolean {
  return stateOf(world, 'plea', world.player.vehicleId, npc.id) !== null;
}

// An NPC's answer to the player's demand for its cargo, rolled once.
export function answersThreat(world: World, npc: Vehicle): ThreatAnswer {
  const me = playerVehicle(world);
  return decide(world, npc, 'threatened', me.id, perceiveDanger(world, npc, me));
}

// A driver that complies drops its cargo and holds a truce with the player. Otherwise it fights or runs.
export function settleThreat(world: World, npc: Vehicle, answer: ThreatAnswer): void {
  const me = playerVehicle(world);
  if (answer === 'comply') yieldTo(world, npc, me);
  else defyThreat(world, npc, me, answer);
}

// ---- Stripping a stranded player. A robber alone with a stranded player offers to strip the truck instead of wrecking
// it. The player who gives up hands over the cargo and the best installed parts and keeps the truck. The player who
// refuses or hangs up faces aimed shots at the cab, so the truck is knocked out with its parts in better shape.

type PartItem = Extract<GridItem, { kind: 'part' }>;

// The driver fights the active player.
function fightsPlayer(world: World, npc: Vehicle): boolean {
  const top = npc.brain ? topGoal(npc) : null;
  return top?.kind === 'fight' && top.targetId === world.player.vehicleId && world.player.state === 'active';
}

// The driver fights the stranded player, wants its cargo, and sees no other foe.
export function hasStrandedPrey(world: World, npc: Vehicle): boolean {
  const me = playerVehicle(world);
  if (!fightsPlayer(world, npc)) return false;
  return isStranded(world, me) && wantsLoot(world, npc, me) && visibleHostiles(world, npc).every((foe) => foe.id === me.id);
}

// Installed parts that can leave the truck, best first.
function removableParts(victim: Vehicle): PartItem[] {
  return victim.items
    .filter((item): item is PartItem => item.kind === 'part' && isMounted(victim.chassisId, item) && takeError(victim, item) === null)
    .sort((a, b) => partSellPrice(b.part) - partSellPrice(a.part));
}

// The prey has something to take.
export function hasStrippable(victim: Vehicle): boolean {
  return hasCargo(victim) || removableParts(victim).length > 0;
}

// The wanted parts go onto the ground. The pile they land on is returned, or null when none left the truck.
function dumpWantedParts(world: World, victim: Vehicle): SalvageStock | null {
  let pile: SalvageStock | null = null;
  for (let taken = 0; taken < RULES.surrenderParts; taken++) {
    const best = removableParts(victim)[0];
    if (!best) break;
    pile = dumpOnPile(world, victim, best);
  }
  if (pile) applyRefitLayout(world, victim, victim.items);
  return pile;
}

// Where a shot from this driver at the target lands: at the cab once the prey refused to give up, else anywhere.
export function aimAt(world: World, shooter: Vehicle, target: Vehicle): Aim {
  if (target.id !== world.player.vehicleId || !hasStrandedPrey(world, shooter)) return 'body';
  return world.player.talked[shooter.id]?.surrender === 'refused' ? corePart(target, 'cab').id : 'body';
}
