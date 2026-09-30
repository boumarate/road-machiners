// Ending or dodging a fight by talk. A truce ends the feuds between two sides for a while. Mercy is a truce the
// loser buys with its cargo. A threat asks a driver at peace for its cargo. An NPC answers each with a weighted
// decision. Radio talk with the player lives in src/sim/dialogue.ts, and this module owns what the answers do.

import { SPAWN } from '../data/npcs';
import { isHostile } from './combat';
import { isKnockedOut } from './defeat';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { partSellPrice } from './economy';
import { corePart, isMounted } from './grid';
import { applyRefitLayout } from './inventory';
import { creditBounty } from './market';
import { defyThreat, finishGoal, pushGoal, topGoal } from './npc-activities';
import { decide, firepower, perceiveDanger, visibleHostiles, wantsLoot } from './npc-decisions';
import { SPARE_LINE } from '../data/dialogue';
import { vehicleHasPerk } from './progress';
import { backedOff, claimantOf, claimPile, createCargoSalvage, dumpOnPile, hasCargo, takeError } from './salvage';
import { isStranded } from './stats';
import { addState, endState, pleaData, stateOf } from './states';
import type { DecisionOptions } from '../data/npcs';
import type { Aim, GridItem, Plea, SalvageStock, Vehicle, World } from './types';
import { canVehicleSee } from './vision';
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
  if (stock && winner.brain) {
    pushGoal(world, winner, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'take the handed-over cargo' });
    claimPile(world, stock, winner);
  }
  creditYield(world, loser, winner);
}

// A stranded truck gives up to a robber: the cargo and the best installed parts go onto the ground, and the truck stays.
export function surrenderTo(world: World, loser: Vehicle, robber: Vehicle): void {
  yieldTo(world, loser, robber, dumpWantedParts(world, loser));
}

// A stranded truck gives up to a driver that takes nothing: both sides make peace and the truck keeps everything.
export function giveUpTo(world: World, loser: Vehicle, winner: Vehicle): void {
  makePeace(world, loser, winner);
  const grudge = stateOf(world, 'revenge', winner.id, loser.id);
  if (grudge) endState(world, grudge, 'fulfilled');
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

// Only a refused plea holds the pleader back from pleading again. A granted one ends, so a driver whose truce
// breaks can plead again at once.
function grantPlea(world: World, pleader: Vehicle, answerer: Vehicle, plea: Plea): void {
  const held = stateOf(world, 'plea', pleader.id, answerer.id);
  if (!held) throw new Error(`${pleader.id} holds no plea to ${answerer.id}`);
  endState(world, held, 'fulfilled');
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

// ---- Pile claims. A robber handed a pile claims it, so it warns other drivers off while it takes the loot.

// The claimant fights a trespasser that refuses to back off, or runs when it has no firepower.
export function defendClaim(world: World, claimant: Vehicle, trespasser: Vehicle): void {
  defyThreat(world, claimant, trespasser, firepower(world, claimant) > 0 ? 'fightBack' : 'flee', 'defend its claimed loot');
}

// An NPC about to search a claimed pile that its claimant sees answers the warning. True when it does not search.
export function warnedOff(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  const claimant = claimantOf(world, stock);
  if (!claimant || claimant.id === vehicle.id || !canVehicleSee(world, claimant, vehicle.pos)) return false;
  if (!backedOff(stock, vehicle.id)) {
    const answer = decide(world, vehicle, 'threatened', claimant.id, perceiveDanger(world, vehicle, claimant));
    if (answer === 'fightBack') {
      defyThreat(world, vehicle, claimant, 'fightBack', 'take the claimed loot');
      defendClaim(world, claimant, vehicle);
      return true;
    }
    stock.pile!.claim!.warned.push(vehicle.id);
  }
  finishGoal(world, vehicle, 'the loot is claimed');
  return true;
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

// The driver fights the stranded player and sees no other foe.
export function hasStrandedPrey(world: World, npc: Vehicle): boolean {
  return fightsPlayer(world, npc) && strandedPrey(world, npc)?.id === world.player.vehicleId;
}

// The stranded truck the driver fights with no other foe in sight, player or NPC, or null.
export function strandedPrey(world: World, npc: Vehicle): Vehicle | null {
  const prey = fightTarget(world, npc);
  if (!prey || !isBeaten(world, npc, prey)) return null;
  return visibleHostiles(world, npc).every((foe) => foe.id === prey.id) ? prey : null;
}

function fightTarget(world: World, npc: Vehicle): Vehicle | null {
  const top = npc.brain ? topGoal(npc) : null;
  if (top?.kind !== 'fight') return null;
  return world.vehicles.find((v) => v.id === top.targetId) ?? null;
}

// The prey can no longer drive but is still in the fight: stranded, awake and hostile.
function isBeaten(world: World, npc: Vehicle, prey: Vehicle): boolean {
  return isStranded(world, prey) && !isKnockedOut(prey) && isHostile(world, npc, prey);
}

// The driver takes cargo and parts from the prey: a robber, and the prey has something to take.
function strips(world: World, npc: Vehicle, prey: Vehicle): boolean {
  return wantsLoot(world, npc, prey) && hasStrippable(prey);
}

// A driver alone with the stranded player that takes nothing from it: not a robber, or a robber with nothing to take.
export function offersGiveUp(world: World, npc: Vehicle): boolean {
  return hasStrandedPrey(world, npc) && !strips(world, npc, playerVehicle(world));
}

// A driver alone with a stranded foe decides once what to do with it. A driver that takes nothing may judge the foe not
// worth the trouble and leave in peace. Otherwise it offers the foe a way out: the player hears it on the radio, and
// an NPC foe answers at once, giving up or holding out.
export function judgeStrandedFoe(world: World, npc: Vehicle): void {
  const prey = strandedPrey(world, npc);
  if (!prey || `strandedFoe:${prey.id}` in npc.brain!.noticed) return;
  npc.brain!.noticed[`strandedFoe:${prey.id}`] = world.turn;
  const robs = strips(world, npc, prey);
  if (!robs && decide(world, npc, 'strandedFoe', prey.id, null) === 'spare') return spare(world, npc, prey);
  if (prey.brain) answerOffer(world, prey, npc, robs);
}

function spare(world: World, npc: Vehicle, prey: Vehicle): void {
  if (!prey.brain) world.events.push({ t: 'say', speaker: npc.id, text: SPARE_LINE, vars: {} });
  makePeace(world, npc, prey);
}

// A stranded NPC offered a way out gives up, stripped by a robber or let go by anyone else, or holds out and draws fire
// at its cab.
function answerOffer(world: World, prey: Vehicle, winner: Vehicle, robs: boolean): void {
  prey.brain!.noticed[`surrenderOffered:${winner.id}`] = world.turn;
  if (decide(world, prey, 'surrenderOffered', winner.id, null) === 'refuse') return;
  if (robs) surrenderTo(world, prey, winner);
  else giveUpTo(world, prey, winner);
}

// Whether the driver judged the stranded player and chose to offer a way to stand down.
export function judgedWorthOffer(world: World, npc: Vehicle): boolean {
  return `strandedFoe:${world.player.vehicleId}` in npc.brain!.noticed;
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

// The prey refused or, for the player, hung up on this driver's offer to end the fight. An NPC prey that answered and
// is still fighting refused, since giving up makes peace.
function refusedOffer(world: World, shooter: Vehicle, prey: Vehicle): boolean {
  if (prey.brain) return `surrenderOffered:${shooter.id}` in prey.brain.noticed;
  const talked = world.player.talked[shooter.id];
  return talked?.surrender === 'refused' || talked?.giveUp === 'refused';
}

// Where a shot from this driver at the target lands: at the cab once the stranded prey refused to give up, else
// anywhere.
export function aimAt(world: World, shooter: Vehicle, target: Vehicle): Aim {
  if (strandedPrey(world, shooter)?.id !== target.id) return 'body';
  return refusedOffer(world, shooter, target) ? corePart(target, 'cab').id : 'body';
}
