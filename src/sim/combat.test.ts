import { chooseOption, currentOptions } from './dialogue';
import { describe, expect, it } from 'vitest';
import { PERK_NUMBERS, XP_TO_REACH } from '../data/skills';
import { RULES } from '../data/rules';
import { SPAWN } from '../data/npcs';
import { REGION } from '../data/region';
import { getResources } from './resources';
import { siteGates } from './sites';
import { autoOrders, fireWeapons, hitOdds, laneOfOffset, resolveDestroyed } from './combat';
import { mountedItems, mountedParts } from './grid';
import { stateOf } from './states';
import { refreshVision } from './vision';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, testDrive } from './testkit';
import type { GameEvent, Vehicle, World } from './types';
import { dist } from './vec';
import { endTurn } from './world';

function duel(targetPos = { x: 33, y: 30 }) {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], targetPos, Math.PI);
  buggy.brain = npcBrain('buggy', targetPos, ['raider']);
  const mg = vehicleStats(w, me).weapons[0];
  return { w, me, buggy, mg };
}

// The player's scout swapped for a hauler with a forward cannon on deck beside its cab, where the cannon can fire forward.
function cannonHauler(w: World): Vehicle {
  const old = w.vehicles[0];
  const v = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], old.pos, old.heading);
  v.id = old.id;
  w.vehicles = [v, ...w.vehicles.slice(1, -1)];
  return v;
}

function order(me: Vehicle, weaponId: string, targetId: string, aim = 'body') {
  me.weaponOrders[weaponId] = { targetId, aim };
}

describe('combat', () => {
  it('does not fire out of range', () => {
    const { w, me, buggy, mg } = duel({ x: 45, y: 30 });
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.filter((e) => e.t === 'shot')).toHaveLength(0);
  });

  it('fires in range and starts reload', () => {
    const { w, me, buggy, mg } = duel();
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(true);
    expect(mg.part.reload).toBe(mg.def.reload - 1);
  });

  it('forward arc blocks shots to the side', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.chassisId = 'hauler';
    me.items = [
      { id: 'i1', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, reload: 0, wear: 0 } },
      { id: 'i2', x: 4, y: 0, rot: 0, kind: 'part', part: { id: 'e1', defId: 'stockEngine', hp: 25, reload: 0, wear: 0 } },
    ];
    const side = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 35 });
    order(me, 'c1', side.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('cannon reloads for several turns', () => {
    const w = emptyWorld();
    const me = cannonHauler(w);
    const t = addVehicle(w, 'raiders', 'wagon', ['cannon', 'stockEngine', 'plates'], { x: 35, y: 30 }, Math.PI);
    order(me, vehicleStats(w, me).weapons[0].part.id, t.id);
    let shots = 0;
    for (let i = 0; i < 6; i++) {
      w.events = [];
      fireWeapons(w);
      shots += w.events.filter((e) => e.t === 'shot' && e.shooter === me.id).length;
    }
    expect(shots).toBe(2);
  });

  it('aimed shots have lower hit chance', () => {
    const { w, me, buggy, mg } = duel();
    me.speed = 4;
    const body = hitOdds(w, me, mg, buggy, 'body');
    const aimed = hitOdds(w, me, mg, buggy, mountedParts(buggy, 'weapon')[0].id);
    expect(aimed.width).toBeLessThan(body.width);
    expect(aimed.chance).toBeLessThan(body.chance);
  });

  it('aimed hits damage the part and a part at zero is disabled', () => {
    const { w, me, buggy, mg } = duel({ x: 31.5, y: 30 });
    const gun = mountedParts(buggy, 'weapon')[0];
    gun.hp = 1;
    order(me, mg.part.id, buggy.id, gun.id);
    for (let i = 0; i < 40 && gun.hp > 0; i++) {
      mg.part.reload = 0;
      fireWeapons(w);
    }
    expect(gun.hp).toBe(0);
    expect(w.events.some((e) => e.t === 'partDisabled' && e.part === gun.id)).toBe(true);
  });

  it('a disabled weapon never fires', () => {
    const { w, me, buggy, mg } = duel();
    mg.part.hp = 0;
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('a disabled engine caps speed', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBe(RULES.limpSpeed);
  });

  it('a kill leaves a wreck obstacle and pays the player nothing', () => {
    const { w, me, buggy } = duel();
    getResources(w, buggy).health = 0;
    buggy.lastHitBy = me.id;
    const money = w.player.money;
    resolveDestroyed(w);
    expect(w.vehicles.find((v) => v.id === buggy.id)).toBeUndefined();
    expect(w.obstacles.some((o) => o.kind === 'wreck' && dist(o.pos, buggy.pos) === 0)).toBe(true);
    expect(w.player.money).toBe(money);
  });

  it('old kill wrecks are cleared past the cap', () => {
    const { w, me } = duel();
    for (let i = 0; i < RULES.maxKillWrecks + 3; i++) {
      const b = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10 + i * 2, y: 10 });
      b.brain = npcBrain('buggy', b.pos, ['raider']);
      getResources(w, b).health = 0;
      b.lastHitBy = me.id;
      resolveDestroyed(w);
    }
    expect(w.obstacles.filter((o) => o.id.startsWith('wreck-'))).toHaveLength(RULES.maxKillWrecks);
  });

  it('clearing an old kill wreck stops a search of it', () => {
    const { w } = duel();
    const kill = () => {
      const b = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10 + w.obstacles.length * 2, y: 10 });
      b.brain = npcBrain('buggy', b.pos, ['raider']);
      getResources(w, b).health = 0;
      resolveDestroyed(w);
      return b.id;
    };
    const oldest = kill();
    const searcher = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 14 });
    searcher.job = { kind: 'search', stockId: `wreck-${oldest}`, turnsLeft: 3, total: 3 };
    for (let i = 0; i < RULES.maxKillWrecks; i++) kill();
    expect(w.salvage.some((s) => s.id === `wreck-${oldest}`)).toBe(false);
    expect(searcher.job).toBeNull();
  });

  it('shooting a neutral makes it and its nearby mates hostile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 33, y: 30 });
    const mate = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 36, y: 33 });
    order(me, vehicleStats(w, me).weapons[0].part.id, trader.id);
    fireWeapons(w);
    expect(stateOf(w, 'feud', trader.id, me.id)).not.toBeNull();
    expect(stateOf(w, 'feud', mate.id, me.id)).not.toBeNull();
    expect(w.events.filter((e) => e.t === 'hostile')).toEqual([
      { t: 'hostile', vehicle: trader.id, against: me.id },
      { t: 'hostile', vehicle: mate.id, against: me.id },
    ]);
  });

  it('raiders attack the player within aggro range over a few turns', () => {
    const { w, me, buggy } = duel({ x: 38, y: 30 });
    forceOption('hostileSeen', 'fight');
    let world = w;
    let shotAt = false;
    for (let i = 0; i < 6; i++) {
      // A raider radios its demand first. Refusing keeps the fight.
      if (world.player.call) world = chooseOption(world, currentOptions(world).findIndex((o) => o.text === 'Come and get it.'));
      world = endTurn(world, testDrive);
      if (world.events.some((e) => e.t === 'shot' && e.shooter === buggy.id && e.target === me.id)) shotAt = true;
    }
    expect(shotAt).toBe(true);
  });
});

type Shot = Extract<GameEvent, { t: 'shot' }>;
const shotsBy = (events: GameEvent[], id: string) => events.filter((e): e is Shot => e.t === 'shot' && e.shooter === id);

// Player at (30, 30) facing +x, a buggy `d` tiles ahead. Heading PI / 2 shows its left side, PI its nose.
function range(d: number, heading: number, speed = 0) {
  const { w, me, buggy, mg } = duel({ x: 30 + d, y: 30 });
  buggy.heading = heading;
  buggy.speed = speed;
  return { w, me, buggy, mg };
}

describe('hit odds', () => {
  const broadside = Math.PI / 2;

  it('falls with distance', () => {
    const near = range(2, broadside, 3);
    const far = range(5, broadside, 3);
    const a = hitOdds(near.w, near.me, near.mg, near.buggy, 'body');
    const b = hitOdds(far.w, far.me, far.mg, far.buggy, 'body');
    expect(b.halfAngle).toBeLessThan(a.halfAngle);
    expect(b.chance).toBeLessThan(a.chance);
  });

  it('rises when the target shows its side', () => {
    const side = range(5, broadside);
    const nose = range(5, Math.PI);
    side.me.speed = nose.me.speed = 6;
    const a = hitOdds(side.w, side.me, side.mg, side.buggy, 'body');
    const b = hitOdds(nose.w, nose.me, nose.mg, nose.buggy, 'body');
    expect(a.width).toBeGreaterThan(b.width);
    expect(a.chance).toBeGreaterThan(b.chance);
  });

  it('crossing speed lowers chance, and head-on closing does not', () => {
    const still = range(5, broadside, 0);
    still.me.speed = 4;
    const base = hitOdds(still.w, still.me, still.mg, still.buggy, 'body');
    still.buggy.speed = 5;
    const crossing = hitOdds(still.w, still.me, still.mg, still.buggy, 'body');
    expect(crossing.causes.crossing).toBeGreaterThan(0);
    expect(crossing.chance).toBeLessThan(base.chance);
    const nose = range(5, Math.PI, 0);
    nose.me.speed = 4;
    const idle = hitOdds(nose.w, nose.me, nose.mg, nose.buggy, 'body');
    nose.buggy.speed = 5;
    const closing = hitOdds(nose.w, nose.me, nose.mg, nose.buggy, 'body');
    expect(closing.causes.crossing).toBeCloseTo(0, 9);
    expect(closing.chance).toBeCloseTo(idle.chance, 9);
  });

  it('faster rounds and gunnery raise chance, own speed lowers it', () => {
    const { w, me, buggy, mg } = range(5, broadside, 4);
    me.speed = 3;
    const base = hitOdds(w, me, mg, buggy, 'body');
    const fast = { ...mg, def: { ...mg.def, round: { ...mg.def.round, speed: mg.def.round.speed * 2 } } };
    expect(hitOdds(w, me, fast, buggy, 'body').chance).toBeGreaterThan(base.chance);
    w.player.skills.perception = XP_TO_REACH[3];
    const skilled = hitOdds(w, me, mg, buggy, 'body');
    expect(skilled.causes.skill).toBeLessThan(0);
    expect(skilled.chance).toBeGreaterThan(base.chance);
    w.player.skills.perception = 0;
    me.speed = 6;
    const shaky = hitOdds(w, me, mg, buggy, 'body');
    expect(shaky.causes.own).toBeGreaterThan(base.causes.own);
    expect(shaky.chance).toBeLessThan(base.chance);
  });

  it('spread is the sum of its causes', () => {
    const { w, me, buggy, mg } = range(4, broadside, 3);
    me.speed = 2;
    const o = hitOdds(w, me, mg, buggy, 'body');
    expect(o.spread).toBeCloseTo(o.causes.weapon + o.causes.skill + o.causes.crossing + o.causes.own + o.causes.recoil, 12);
    expect(o.halfAngle).toBeCloseTo(o.width / (2 * o.distance), 12);
  });
});

describe('rounds', () => {
  it('the MG fires `rounds` independent rolls', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    me.speed = 3;
    order(me, mg.part.id, buggy.id);
    let mixed = false;
    for (let i = 0; i < 20; i++) {
      w.events = [];
      mg.part.reload = 0;
      fireWeapons(w);
      const [shot] = shotsBy(w.events, me.id);
      expect(shot.rounds).toHaveLength(mg.def.rounds);
      const hits = shot.rounds.filter((r) => r.hit).length;
      if (hits > 0 && hits < mg.def.rounds) mixed = true;
    }
    expect(mixed).toBe(true);
  });

  it('a share of hits are crits, which deal more damage than plain hits', () => {
    const { w, me, buggy, mg } = range(3, Math.PI / 2, 5);
    for (const p of mountedParts(buggy)) p.hp = 1e9;
    order(me, mg.part.id, buggy.id);
    let hits = 0;
    let crits = 0;
    let critDamage = 0;
    let plainDamage = 0;
    for (let i = 0; i < 400; i++) {
      w.events = [];
      mg.part.reload = 0;
      fireWeapons(w);
      for (const r of shotsBy(w.events, me.id)[0].rounds) {
        if (!r.hit) continue;
        hits++;
        const dealt = r.hits.reduce((a, h) => a + h.damage, 0);
        if (r.crit) { crits++; critDamage += dealt; } else plainDamage += dealt;
      }
    }
    expect(Math.abs(crits / hits - RULES.critChance)).toBeLessThan(0.03);
    expect(critDamage / crits).toBeGreaterThan((plainDamage / (hits - crits)) * 1.5);
  });

  it('rounds hit as often as the odds say', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    me.speed = 3;
    for (const p of mountedParts(buggy)) p.hp = 1e9; // keep the target whole, so every round sees the same truck
    order(me, mg.part.id, buggy.id);
    const p = hitOdds(w, me, mg, buggy, 'body').chance;
    let hits = 0;
    let rounds = 0;
    for (let i = 0; i < 300; i++) {
      w.events = [];
      mg.part.reload = 0;
      fireWeapons(w);
      for (const r of shotsBy(w.events, me.id)[0].rounds) {
        rounds++;
        if (r.hit) hits++;
      }
    }
    expect(Math.abs(hits / rounds - p)).toBeLessThan(0.05);
  });

  it('an aimed miss that lands on the truck hits the lane where it landed', () => {
    const { w, me, buggy, mg } = range(4, Math.PI);
    for (const p of mountedParts(buggy)) p.hp = 1e9; // keep the target whole, so every round sees the same truck
    const wheel = mountedItems(buggy).find((it) => it.x === 0 && it.y === 1)!.part; // front left, lane 0 from the front
    order(me, mg.part.id, buggy.id, wheel.id);
    const odds = hitOdds(w, me, mg, buggy, wheel.id);
    expect(odds.bodyChance).toBeGreaterThan(odds.chance);
    expect(odds.bodyChance).toBeLessThanOrEqual(1);
    let hits = 0;
    let rounds = 0;
    const struck = new Set<string>();
    for (let i = 0; i < 300; i++) {
      w.events = [];
      mg.part.reload = 0;
      fireWeapons(w);
      for (const r of shotsBy(w.events, me.id)[0].rounds) {
        rounds++;
        if (!r.hit) continue;
        hits++;
        expect(r.hits.length).toBeGreaterThan(0);
        struck.add(r.hits[0].part);
      }
    }
    expect([...struck].some((id) => id !== wheel.id)).toBe(true);
    expect(Math.abs(hits / rounds - odds.bodyChance)).toBeLessThan(0.05);
  });

  it('a body shot hits the truck as often as it hits anything', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    const o = hitOdds(w, me, mg, buggy, 'body');
    expect(o.bodyChance).toBe(o.chance);
  });

  it('the same seed gives the same rounds', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    order(me, mg.part.id, buggy.id);
    const copy = structuredClone(w);
    fireWeapons(w);
    fireWeapons(copy);
    expect(shotsBy(copy.events, me.id)).toEqual(shotsBy(w.events, me.id));
  });

  it('a hit lands on the lane under its offset', () => {
    const n = 4;
    // Seen from behind, the shooter's right is the target's right, the high columns.
    expect(laneOfOffset('rear', 1.9, n, 0.9)).toBe(n - 1);
    expect(laneOfOffset('rear', 1.9, n, -0.9)).toBe(0);
    // Seen from the front, the shooter's right is the target's left, column 0.
    expect(laneOfOffset('front', 1.9, n, 0.9)).toBe(0);
    expect(laneOfOffset('front', 1.9, n, -0.9)).toBe(n - 1);
  });

  it('a cannon miss within splash radius damages a part', () => {
    const w = emptyWorld();
    const me = cannonHauler(w);
    const t = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI / 2);
    for (const p of mountedParts(t)) p.hp = 1e9;
    t.speed = 3;
    me.speed = 4;
    order(me, vehicleStats(w, me).weapons[0].part.id, t.id);
    const cannon = vehicleStats(w, me).weapons[0];
    let splashed = false;
    for (let i = 0; i < 60 && !splashed; i++) {
      w.events = [];
      cannon.part.reload = 0;
      fireWeapons(w);
      const miss = shotsBy(w.events, me.id)[0].rounds.find((r) => !r.hit);
      if (miss && miss.hits.length > 0) splashed = true;
    }
    expect(splashed).toBe(true);
  });
});

describe('player vision', () => {
  it('auto fire and manual orders ignore raiders out of sight', async () => {
    const { setWeaponOrder } = await import('./world');
    const { autoOrders } = await import('./combat');
    const { w, me } = duel({ x: 55, y: 30 });
    w.player.autoFire = true;
    autoOrders(w, me);
    expect(me.weaponOrders).toEqual({});
    const far = w.vehicles.find((v) => v.faction === 'raiders')!;
    expect(() => setWeaponOrder(w, vehicleStats(w, me).weapons[0].part.id, { targetId: far.id, aim: 'body' })).toThrow(/cannot see/);
  });

  it('a rock between you and a raider blocks the shot', () => {
    const { w, me, buggy, mg } = duel({ x: 34, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 32, y: 30 }, r: 0.8, kind: 'rock' }];
    refreshVision(w);
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('a raider seen behind a rock inside the close radius cannot be shot', async () => {
    const { fireBlock } = await import('./combat');
    const { playerSees } = await import('./vision');
    const { w, me, buggy, mg } = duel({ x: 32.5, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30 }, r: 0.6, kind: 'rock' }];
    refreshVision(w);
    expect(playerSees(w, buggy.pos)).toBe(true);
    expect(fireBlock(w, me, mg, buggy)).toBe('covered');
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });
});

describe('NPC attack records and defensive fire', () => {
  it('records every shot at the driver or a nearby faction mate it sees as an attack, even a miss', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    const mate = addVehicle(w, 'scavengers', 'scout', [], { x: 12, y: 12 });
    const far = addVehicle(w, 'scavengers', 'scout', [], { x: 10 + SPAWN.neighborHelp + 8, y: 10 });
    const shootAt = (target: Vehicle) => {
      w.events = [];
      raider.weaponOrders = { [mountedParts(raider, 'weapon')[0].id]: { targetId: target.id, aim: 'body' } };
      raider.pos = { x: target.pos.x + 4, y: target.pos.y };
      fireWeapons(w);
      expect(w.events.some((e) => e.t === 'shot' && e.target === target.id)).toBe(true);
      getResources(w, target).health = RULES.maxHealth;
      mountedParts(raider, 'weapon')[0].reload = 0;
    };
    shootAt(far);
    expect(npc.brain!.attackers).toEqual({});
    shootAt(mate);
    expect(npc.brain!.attackers).toEqual({ [raider.id]: false });
    npc.brain!.attackers[raider.id] = true;
    shootAt(npc);
    expect(npc.brain!.attackers).toEqual({ [raider.id]: false });
  });

  it('an NPC opens fire only on its fight target away from guards, and always on an attacker', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const npc = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    const prey = addVehicle(w, 'traders', 'scout', ['mg'], { x: 33, y: 30 });
    const aimed = () => Object.values(npc.weaponOrders).map((order) => order.targetId);
    autoOrders(w, npc);
    expect(aimed()).toEqual([]);
    npc.brain.goals = [{ kind: 'fight', targetId: prey.id, destination: { ...prey.pos }, phase: 'travel', reason: 'test fight' }];
    autoOrders(w, npc);
    expect(aimed()).toEqual([prey.id]);
    const gate = siteGates(REGION.towns[0])[0];
    npc.pos = { x: gate.x + 3, y: gate.y };
    prey.pos = { ...gate };
    autoOrders(w, npc);
    expect(aimed()).toEqual([]);
    npc.brain.goals = [{ kind: 'flee', targetId: prey.id, destination: { x: 100, y: 100 }, phase: 'travel', reason: 'test flee' }];
    npc.brain.attackers = { [prey.id]: true };
    autoOrders(w, npc);
    expect(aimed()).toEqual([prey.id]);
  });
});

describe('hit practice', () => {
  it('pays the player per round that hits, harder at a lower chance', () => {
    const { w, me, buggy, mg } = duel();
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      w.events = [];
      mg.part.reload = 0;
      order(me, mg.part.id, buggy.id);
      fireWeapons(w);
      const shot = w.events.find((e) => e.t === 'shot' && e.shooter === me.id);
      if (shot?.t !== 'shot') throw new Error('The player did not fire');
      for (const event of practiceOf(w, 'hit')) {
        expect(event.difficulty).toBeCloseTo(1 - shot.chance);
        expect(event.amount).toBeLessThanOrEqual(shot.rounds.length);
        hits += event.amount;
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('pays nothing for an NPC hitting the player', () => {
    const { w, me, buggy } = duel();
    const gun = vehicleStats(w, buggy).weapons[0];
    for (let i = 0; i < 10; i++) {
      gun.part.reload = 0;
      order(buggy, gun.part.id, me.id);
      fireWeapons(w);
    }
    expect(w.events.filter((e) => e.t === 'shot' && e.shooter === buggy.id)).toHaveLength(10);
    expect(practiceOf(w, 'hit')).toEqual([]);
  });
});

describe('aim perks', () => {
  const broadside = Math.PI / 2;

  it('steady aim takes the scatter of own speed away from the player', () => {
    const { w, me, buggy, mg } = range(5, broadside);
    me.speed = 6;
    const shaky = hitOdds(w, me, mg, buggy, 'body');
    w.player.perks.push('steadyAim');
    const steady = hitOdds(w, me, mg, buggy, 'body');
    expect(shaky.causes.own).toBeGreaterThan(0);
    expect(steady.causes.own).toBe(0);
    expect(steady.chance).toBeGreaterThan(shaky.chance);
  });

  it('steady aim leaves an NPC shooter shaking', () => {
    const { w, me, buggy } = range(5, broadside);
    buggy.speed = 6;
    const gun = vehicleStats(w, buggy).weapons[0];
    const before = hitOdds(w, buggy, gun, me, 'body');
    w.player.perks.push('steadyAim');
    expect(hitOdds(w, buggy, gun, me, 'body').causes.own).toBe(before.causes.own);
  });

  it('called shot cuts the spread of the player aimed shots only', () => {
    const { w, me, buggy, mg } = range(5, broadside);
    const part = mountedParts(buggy, 'weapon')[0].id;
    const aimed = hitOdds(w, me, mg, buggy, part);
    const body = hitOdds(w, me, mg, buggy, 'body');
    w.player.perks.push('calledShot');
    expect(hitOdds(w, me, mg, buggy, part).spread).toBeCloseTo(aimed.spread * PERK_NUMBERS.calledShot.spread, 12);
    expect(hitOdds(w, me, mg, buggy, 'body').spread).toBe(body.spread);
  });

  it('called shot leaves NPC aimed shots alone', () => {
    const { w, me, buggy } = range(5, broadside);
    const gun = vehicleStats(w, buggy).weapons[0];
    const part = mountedParts(me, 'weapon')[0].id;
    const before = hitOdds(w, buggy, gun, me, part);
    w.player.perks.push('calledShot');
    expect(hitOdds(w, buggy, gun, me, part).spread).toBe(before.spread);
  });
});

describe('recoil and shake', () => {
  // A tank gun on the given chassis, facing a buggy 5 tiles ahead.
  function tankGunOn(chassisId: string) {
    const w = emptyWorld();
    const shooter = addVehicle(w, 'player', chassisId, ['stockEngine', 'tankGun'], { x: 60, y: 60 });
    const target = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 65, y: 60 }, Math.PI / 2);
    return { w, shooter, target, gun: vehicleStats(w, shooter).weapons[0] };
  }

  it('a heavy gun kicks harder on a light truck', () => {
    const light = tankGunOn('scout');
    const heavy = tankGunOn('tractor');
    const a = hitOdds(light.w, light.shooter, light.gun, light.target, 'body');
    const b = hitOdds(heavy.w, heavy.shooter, heavy.gun, heavy.target, 'body');
    expect(a.causes.recoil).toBeGreaterThan(b.causes.recoil);
    expect(a.chance).toBeLessThan(b.chance);
  });

  it('a light gun barely kicks', () => {
    const { w, me, buggy, mg } = duel();
    const odds = hitOdds(w, me, mg, buggy, 'body');
    expect(odds.causes.recoil).toBeLessThan(odds.causes.weapon / 10);
  });

  it('a stabilized gun loses less aim to its own speed than a sniper cannon', () => {
    const w = emptyWorld();
    const shooter = addVehicle(w, 'player', 'tractor', ['stockEngine', 'mg', 'sniperCannon'], { x: 60, y: 60 });
    const target = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 65, y: 60 }, Math.PI / 2);
    shooter.speed = 4;
    const [mg, sniper] = ['mg', 'sniperCannon'].map((id) => vehicleStats(w, shooter).weapons.find((x) => x.def.id === id)!);
    expect(hitOdds(w, shooter, mg, target, 'body').causes.own).toBeLessThan(hitOdds(w, shooter, sniper, target, 'body').causes.own);
  });
});

describe('weapon damage multiplier', () => {
  // A cannon on a hauler fires at a sturdy buggy from the given RNG state. Returns the damage of each part hit.
  function dealt(mult: number, rngState: number): number[] {
    const saved = RULES.weaponDamage;
    (RULES as { weaponDamage: number }).weaponDamage = mult;
    try {
      const w = emptyWorld();
      w.rngState = rngState;
      const me = cannonHauler(w);
      const t = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: me.pos.x + 4, y: me.pos.y }, Math.PI / 2);
      for (const p of mountedParts(t)) p.hp = 1e9;
      order(me, vehicleStats(w, me).weapons[0].part.id, t.id);
      fireWeapons(w);
      return shotsBy(w.events, me.id).flatMap((s) => s.rounds).flatMap((r) => r.hits).map((h) => h.damage);
    } finally {
      (RULES as { weaponDamage: number }).weaponDamage = saved;
    }
  }

  // Each hit rounds to whole HP, so each can differ from the exact half by up to 0.5.
  it('scales every hit by the one multiplier', () => {
    // The first RNG state from 1 whose shot lands, so both multipliers roll the same hits. A shot that
    // misses a sturdy buggy at 4 tiles in a thousand states in a row fails the length check below.
    let state = 1;
    while (state < 1000 && dealt(1, state).length === 0) state++;
    const full = dealt(1, state);
    const half = dealt(0.5, state);
    expect(full.length).toBeGreaterThan(0);
    expect(half).toHaveLength(full.length);
    half.forEach((d, i) => expect(Math.abs(d - full[i] / 2)).toBeLessThanOrEqual(0.5));
  });
});
