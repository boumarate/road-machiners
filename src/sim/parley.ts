// Ending or dodging a fight by talk. A truce ends the feuds between two sides for a while. Mercy is a truce the
// loser buys with its cargo. A threat asks a driver at peace for its cargo. An NPC answers each with a weighted
// decision. Radio talk with the player lives in src/sim/dialogue.ts, and this module owns what the answers do.

import { SPAWN } from '../data/npcs';
import { playerVehicle } from './damage';
import { defyThreat, pushGoal } from './npc-activities';
import { decide, perceiveDanger } from './npc-decisions';
import { createCargoSalvage, hasCargo } from './salvage';
import { addState, endState, pleaData, stateOf } from './states';
import type { DecisionOptions } from '../data/npcs';
import type { Plea, Vehicle, World } from './types';
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
export function yieldTo(world: World, loser: Vehicle, winner: Vehicle): void {
  const stock = hasCargo(loser) ? createCargoSalvage(world, loser, 1) : null;
  makePeace(world, loser, winner);
  const grudge = stateOf(world, 'revenge', winner.id, loser.id);
  if (grudge) endState(world, grudge, 'fulfilled');
  if (stock && winner.brain) pushGoal(world, winner, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'take the handed-over cargo' });
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
