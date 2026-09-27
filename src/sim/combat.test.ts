import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { fireWeapons, hitOdds, laneOfOffset, resolveDestroyed } from './combat';
import { corePart, mountedItems, mountedParts } from './grid';
import { refreshVision } from './vision';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import type { GameEvent, Vehicle } from './types';
import { dist } from './vec';
import { endTurn } from './world';

function duel(targetPos = { x: 33, y: 30 }) {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], targetPos, Math.PI);
  buggy.brain = { templateId: 'buggy', activity: null, goal: null, home: targetPos, stepIndex: 0, refusedTow: false };
  const mg = vehicleStats(w, me).weapons[0];
  return { w, me, buggy, mg };
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
      { id: 'i1', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, reload: 0 } },
      { id: 'i2', x: 4, y: 0, rot: 0, kind: 'part', part: { id: 'e1', defId: 'stockEngine', hp: 25, reload: 0 } },
    ];
    const side = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 35 });
    order(me, 'c1', side.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('cannon reloads for several turns', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const gun = me.items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    me.items = me.items.filter((it) => it !== gun);
    me.items.push({ id: 'i1', x: gun.x, y: gun.y, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, reload: 0 } });
    const t = addVehicle(w, 'raiders', 'wagon', ['cannon', 'stockEngine', 'plates'], { x: 35, y: 30 }, Math.PI);
    order(me, 'c1', t.id);
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

  it('a kill leaves a wreck obstacle and pays the player', () => {
    const { w, me, buggy } = duel();
    corePart(buggy, 'cab').hp = 0;
    buggy.lastHitBy = me.id;
    const money = w.player.money;
    resolveDestroyed(w);
    expect(w.vehicles.find((v) => v.id === buggy.id)).toBeUndefined();
    expect(w.obstacles.some((o) => o.kind === 'wreck' && dist(o.pos, buggy.pos) === 0)).toBe(true);
    expect(w.player.money).toBeGreaterThan(money);
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it('old kill wrecks are cleared past the cap', () => {
    const { w, me } = duel();
    for (let i = 0; i < RULES.maxKillWrecks + 3; i++) {
      const b = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10 + i * 2, y: 10 });
      b.brain = { templateId: 'buggy', activity: null, goal: null, home: b.pos, stepIndex: 0, refusedTow: false };
      corePart(b, 'cab').hp = 0;
      b.lastHitBy = me.id;
      resolveDestroyed(w);
    }
    expect(w.obstacles.filter((o) => o.id.startsWith('wreck-'))).toHaveLength(RULES.maxKillWrecks);
  });

  it('shooting a neutral makes it and its nearby mates hostile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 33, y: 30 });
    const mate = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 36, y: 33 });
    order(me, vehicleStats(w, me).weapons[0].part.id, trader.id);
    fireWeapons(w);
    expect(trader.grudges).toContain(me.id);
    expect(mate.grudges).toContain(me.id);
  });

  it('raiders attack the player within aggro range over a few turns', () => {
    const { w, me, buggy } = duel({ x: 38, y: 30 });
    let world = w;
    let shotAt = false;
    for (let i = 0; i < 6; i++) {
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
    w.player.skills.gunnery = 3;
    const skilled = hitOdds(w, me, mg, buggy, 'body');
    expect(skilled.causes.skill).toBeLessThan(0);
    expect(skilled.chance).toBeGreaterThan(base.chance);
    w.player.skills.gunnery = 0;
    me.speed = 6;
    const shaky = hitOdds(w, me, mg, buggy, 'body');
    expect(shaky.causes.own).toBeGreaterThan(base.causes.own);
    expect(shaky.chance).toBeLessThan(base.chance);
  });

  it('spread is the sum of its causes', () => {
    const { w, me, buggy, mg } = range(4, broadside, 3);
    me.speed = 2;
    const o = hitOdds(w, me, mg, buggy, 'body');
    expect(o.spread).toBeCloseTo(o.causes.weapon + o.causes.skill + o.causes.crossing + o.causes.own, 12);
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
    const me = w.vehicles[0];
    const gun = me.items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    me.items = me.items.filter((it) => it !== gun);
    me.items.push({ id: 'i1', x: gun.x, y: gun.y, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, reload: 0 } });
    const t = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI / 2);
    for (const p of mountedParts(t)) p.hp = 1e9;
    t.speed = 3;
    me.speed = 4;
    order(me, 'c1', t.id);
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

