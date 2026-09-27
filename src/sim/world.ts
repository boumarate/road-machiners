// World creation and the turn pipeline. No rendering or physics imports: this runs in Node tests.
// Public functions take a world and return a new one. Inside, a cloned draft is mutated.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import type { StartKit } from '../data/start';
import { findPart, playerVehicle } from './damage';
import { makePart, makeVehicle } from './factory';
import { generateObstacles } from './mapgen';
import { buildTerrain } from './terrain';
import { planNpcOrders } from './ai';
import { applyGodMode } from './cheats';
import { assignAutoOrders, fireWeapons, isHostile, resolveDestroyed } from './combat';
import { advanceKnockout, checkDeath, checkKnockout } from './defeat';
import { healPlayer } from './health';
import { fireGuards } from './guards';
import { discoverSites } from './locations';
import { consumeSupplies, leakFuel } from './supplies';
import { spawnInitial, spawnNpcs } from './spawn';
import { clearPiles, initializeSalvage, renewSalvage } from './salvage';
import { timed } from '../perf';
import { noteHurt, resolveNpcActivities } from './npc-activities';
import { advanceStates } from './states';
import { checkBeacon, followTower, isTowed, playerTow } from './tow';
import { endCallIfOut, raiseCalls } from './dialogue';
import { advancePatches } from './patch';
import type { MoveOrder, Vehicle, WeaponOrder, World } from './types';
import { vehicleStats } from './stats';
import { playerSees, refreshVision } from './vision';
import { noteEscape } from './escape';
import { advanceWeather } from './weather';
import { advanceContracts, advanceShops, initializeShops, marketStream } from './market';
import { applyWear } from './wear';
import { advanceDust } from './detect';
import { advanceJobs, startAutoRepair } from './jobs';
import { advanceEngineHeat } from './engine-heat';
import { clamp, dist, type Vec } from './vec';

export function newWorld(seed: number, kit: StartKit): World {
  if (!Number.isInteger(seed))
    throw new Error(`Seed must be an integer, got ${seed}`);
  const world: World = {
    seed,
    rngState: seed,
    marketRng: marketStream(seed),
    turn: 1,
    size: REGION.size,
    nextId: 0,
    vehicles: [],
    obstacles: [],
    salvage: [],
    shops: {},
    terrain: buildTerrain(seed, REGION.size),
    player: {
      vehicleId: "",
      money: kit.money,
      skills: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 },
      xpToday: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 },
      xpDay: 1,
      xpBySource: {
        roughTiles: 0, ram: 0, escape: 0,
        hit: 0, contact: 0, discover: 0,
        fieldJob: 0, patch: 0, search: 0,
        heat: 0, damage: 0, knockout: 0,
        profit: 0, deal: 0, call: 0,
      },
      perks: [],
      health: RULES.maxHealth,
      fuel: kit.fuel,
      supplies: kit.supplies,
      autoFire: false,
      autoRepair: true,
      engineHeat: 0,
      discovered: [REGION.playerStart.town],
      scavenged: [],
      storage: [],
      contracts: [],
      costBasis: { ...kit.costBasis },
      knockouts: 0,
      state: 'active',
      knockoutTurns: 0,
      beacon: false,
      call: null,
      talked: {},
      god: false,
      fullLog: false,
      explored: new Uint8Array(REGION.size * REGION.size),
      visible: [],
      contacts: [],
      clouds: [],
      hostilesSeen: [],
    },
    events: [],
    removed: [],
    spawnTimer: {},
    weather: [],
    dustClouds: [],
    states: [],
  };
  world.obstacles = generateObstacles(world);
  const town = REGION.towns.find((t) => t.id === REGION.playerStart.town)!;
  const truck = makeVehicle(world, {
    name: kit.name,
    faction: "player",
    chassisId: kit.chassis,
    parts: kit.parts.map((defId) => ({ defId, wear: 0 })),
    spares: [],
    cargo: kit.cargo,
    pos: {
      x: town.pos.x + REGION.playerStart.offset.x,
      y: town.pos.y + REGION.playerStart.offset.y,
    },
    heading: -Math.PI / 4,
    brain: null,
  });
  const blocked = world.obstacles.filter(
    (o) => dist(o.pos, truck.pos) < o.r + vehicleStats(world, truck).radius,
  );
  if (blocked.length > 0)
    throw new Error(
      `Player start overlaps ${blocked.map((o) => o.id).join(", ")}`,
    );
  world.vehicles.push(truck);
  world.player.vehicleId = truck.id;
  initializeSalvage(world);
  world.player.storage = kit.storage.map((defId) => makePart(world, defId, 0));
  spawnInitial(world);
  initializeShops(world);
  refreshVision(world);
  world.events = [];
  return world;
}

export function cloneWorld(world: World): World {
  if (!Object.isFrozen(world.terrain)) return structuredClone(world);
  const { terrain, ...state } = world;
  return { ...structuredClone(state), terrain };
}

// Clone, apply, return. Every command and the turn go through this.
export function update(world: World, fn: (draft: World) => void): World {
  const draft = cloneWorld(world);
  draft.events = [];
  draft.removed = [];
  fn(draft);
  return draft;
}

// Whether player commands are allowed now. The UI checks it before issuing one.
export function playerCanAct(world: World): boolean {
  return world.player.state === 'active' && !isTowed(world) && !world.player.call;
}

// Player commands need an awake, living driver who is not on a tow rope or the radio. Unhitch checks the
// rope itself, and the dialogue commands run the call.
export function requireActivePlayer(world: World): void {
  if (world.player.state !== 'active') throw new Error(`Player is ${world.player.state}`);
  if (isTowed(world)) throw new Error('Player is towed');
  if (world.player.call) throw new Error('A radio call is open');
}

// Turns run on their own while the player cannot act, knocked out or towed. They also run while the player waits
// on the beacon: parked with no move order and no offer open. A beacon wait is too many turns to end by hand.
export function autoRuns(world: World): boolean {
  const p = world.player;
  if (p.call) return false; // an open call stops every turn until it ends
  if (p.state === 'knockedOut' || isTowed(world)) return true;
  return waitsOnBeacon(world);
}

function waitsOnBeacon(world: World): boolean {
  const p = world.player;
  const me = playerVehicle(world);
  const parked = me.speed <= RULES.parkedSpeed && (me.order === null || me.order.kind === 'brake');
  return p.state === 'active' && p.beacon && parked && playerTow(world) === null;
}

// A player command: rejected unless the player is active and not towed, then applied like any update.
export function playerCommand(world: World, fn: (draft: World) => void): World {
  requireActivePlayer(world);
  return update(world, fn);
}

export function setMoveOrder(world: World, order: MoveOrder | null): World {
  return playerCommand(world, (w) => {
    playerVehicle(w).order =
      order && order.kind !== "brake"
        ? {
            kind: order.kind,
            dest: {
              x: clamp(order.dest.x, 0, w.size),
              y: clamp(order.dest.y, 0, w.size),
            },
          }
        : order;
  });
}

// move resolves this turn's driving on the draft. The game always plugs in the physics engine
// via src/phys/turn.ts; tests that need a real turn build a Drive and pass physicsMove.
export function endTurn(
  world: World,
  move: (w: World) => void,
): World {
  if (world.player.state === 'dead') throw new Error('The player is dead; no more turns run');
  if (world.player.call) throw new Error('A radio call is open; no turn runs until it ends');
  return timed('turn', () => update(world, (w) => {
    w.turn++;
    advanceWeather(w);
    planNpcOrders(w);
    move(w);
    followTower(w);
    applyWear(w);
    advanceEngineHeat(w);
    advanceDust(w);
    clearPiles(w);
    renewSalvage(w);
    advanceJobs(w);
    startAutoRepair(w);
    refreshVision(w);
    raiseCalls(w);
    assignAutoOrders(w);
    fireWeapons(w);
    fireGuards(w);
    consumeSupplies(w);
    healPlayer(w);
    leakFuel(w);
    applyGodMode(w);
    resolveDestroyed(w);
    advanceContracts(w);
    advancePatches(w);
    advanceStates(w);
    checkBeacon(w);
    resolveNpcActivities(w);
    discoverSites(w);
    checkDeath(w);
    advanceKnockout(w);
    checkKnockout(w);
    spawnNpcs(w);
    advanceShops(w);
    refreshVision(w);
    noteEscape(w);
    noteHurt(w);
    endCallIfOut(w);
    raiseCalls(w);
  }));
}

export function setWeaponOrder(
  world: World,
  weaponId: string,
  order: WeaponOrder | null,
): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    if (!vehicleStats(w, me).weapons.some((m) => m.part.id === weaponId))
      throw new Error(`Player has no weapon ${weaponId}`);
    if (order === null) {
      delete me.weaponOrders[weaponId];
      return;
    }
    const target = w.vehicles.find((v) => v.id === order.targetId);
    if (!target || target.id === me.id)
      throw new Error(`Bad target ${order.targetId}`);
    if (!playerSees(w, target.pos))
      throw new Error("You cannot see that target");
    if (order.aim !== "body" && !findPart(target, order.aim))
      throw new Error(`Target has no part ${order.aim}`);
    me.weaponOrders[weaponId] = order;
  });
}

// Manual mode: the player's truck skips the route planner and drives straight at its order's point.
export function setDirect(world: World, on: boolean): World {
  return playerCommand(world, (w) => {
    playerVehicle(w).direct = on;
  });
}

export function setAutoRepair(world: World, on: boolean): World {
  return update(world, (w) => {
    w.player.autoRepair = on;
  });
}

export function setAutoFire(world: World, on: boolean): World {
  return update(world, (w) => {
    w.player.autoFire = on;
  });
}

export function hostileToPlayer(world: World, v: Vehicle): boolean {
  return isHostile(world, playerVehicle(world), v);
}
