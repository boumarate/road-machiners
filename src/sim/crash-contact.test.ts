import { partDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { PERK_NUMBERS } from '../data/skills';
import { RULES } from '../data/rules';
import { applyContactCrash, computeClosingSpeed, locateCrashContact } from './crash-contact';
import { addVehicle, emptyWorld, practiceOf } from './testkit';
import { vehicleMass } from './mass';
import { mountedParts } from './grid';

describe('crash contacts', () => {
  it('ignores sliding speed and separating contacts', () => {
    expect(computeClosingSpeed({ x: 2, y: 20 }, { x: 1, y: 0 })).toBe(2);
    expect(computeClosingSpeed({ x: -2, y: 20 }, { x: 1, y: 0 })).toBe(0);
  });

  it('selects the touched front lane rather than the whole vehicle', () => {
    const contact = locateCrashContact('scout', [{ x: 2, y: 0 }], { x: 1, y: 0 });
    expect(contact.side).toBe('front');
    expect(contact.lanes).toHaveLength(1);
  });

  it('uses the captured side even after the vehicle turns away', () => {
    const run = (heading: number) => {
      const world = emptyWorld();
      const vehicle = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
      vehicle.heading = heading;
      applyContactCrash(world, vehicle, null, 'rock', 6, { a: { side: 'front', lanes: [2] }, b: null });
      return mountedParts(vehicle).map((part) => ({ def: part.defId, hp: part.hp }));
    };
    expect(run(Math.PI)).toEqual(run(0));
  });

  it('does not damage wheels outside the touched bumper lane', () => {
    const world = emptyWorld();
    const vehicle = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
    const wheels = mountedParts(vehicle).filter((part) => part.defId === 'wheel');
    const before = wheels.map((part) => part.hp);
    applyContactCrash(world, vehicle, null, 'rock', 6, { a: { side: 'front', lanes: [2] }, b: null });
    expect(wheels.map((part) => part.hp)).toEqual(before);
    expect(mountedParts(vehicle).find((part) => part.defId === 'ram')?.hp).toBeLessThan(partDef('ram').hp);
  });

  it('keeps armor protection across simultaneous contact lanes', () => {
    const world = emptyWorld();
    const vehicle = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
    const parts = mountedParts(vehicle);
    const ram = parts.find((part) => part.defId === 'ram');
    const engine = parts.find((part) => part.defId === 'stockEngine');
    if (!ram || !engine) throw new Error('Missing front armor or engine');
    ram.hp = 1;
    const hp = engine.hp;
    applyContactCrash(world, vehicle, null, 'rock', 9, { a: { side: 'front', lanes: [1, 2, 3] }, b: null });
    expect(ram.hp).toBe(0);
    expect(engine.hp).toBe(hp);
  });

  it('rejects missing geometry', () => {
    expect(() => locateCrashContact('scout', [], { x: 1, y: 0 })).toThrow('no contact points');
    expect(() => computeClosingSpeed({ x: 2, y: 0 }, { x: 0, y: 0 })).toThrow('no horizontal direction');
  });
});

describe('ram practice', () => {
  const geometry = { a: { side: 'front' as const, lanes: [1, 2] }, b: { side: 'left' as const, lanes: [1, 2] } };

  it('pays the player for damage dealt, harder against a heavier truck', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const other = addVehicle(world, 'raiders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    applyContactCrash(world, me, other, other.id, 6, geometry);
    const collision = world.events.find((e) => e.t === 'collision');
    if (collision?.t !== 'collision') throw new Error('No collision');
    const dealt = collision.hitsB.reduce((sum, hit) => sum + hit.damage, 0);
    expect(dealt).toBeGreaterThan(0);
    const [event] = practiceOf(world, 'ram');
    expect(event.amount).toBe(dealt);
    expect(event.difficulty).toBeCloseTo(vehicleMass(other) / (vehicleMass(other) + vehicleMass(me)));
  });

  it('pays the player as the second body of a crash', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const other = addVehicle(world, 'raiders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    applyContactCrash(world, other, me, me.id, 6, geometry);
    expect(practiceOf(world, 'ram')).toHaveLength(1);
  });

  it('pays nothing for a crash into a rock', () => {
    const world = emptyWorld();
    applyContactCrash(world, world.vehicles[0], null, 'rock', 6, { a: { side: 'front', lanes: [2] }, b: null });
    expect(practiceOf(world, 'ram')).toEqual([]);
  });

  it('pays nothing for a crash between two NPCs', () => {
    const world = emptyWorld();
    const a = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
    const b = addVehicle(world, 'traders', 'hauler', ['stockEngine'], { x: 42, y: 40 });
    applyContactCrash(world, a, b, b.id, 6, geometry);
    expect(practiceOf(world, 'ram')).toEqual([]);
  });
});

describe('ram guard perk', () => {
  // Total damage a truck takes from a head-on crash into a rock. Crash damage grows with the square of the impact.
  function crashDamage(perk: boolean, npc: boolean, impact = 8): number {
    const world = emptyWorld();
    if (perk) world.player.perks.push('ramGuard');
    const vehicle = npc ? addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 }) : world.vehicles[0];
    const before = mountedParts(vehicle).reduce((sum, part) => sum + part.hp, 0);
    applyContactCrash(world, vehicle, null, 'rock', impact, { a: { side: 'front', lanes: [1, 2, 3] }, b: null });
    return before - mountedParts(vehicle).reduce((sum, part) => sum + part.hp, 0);
  }

  it('makes a crash hurt the player truck like one with half the energy', () => {
    const halfEnergy = crashDamage(false, false, 8 * Math.sqrt(PERK_NUMBERS.ramGuard.crashTaken));
    expect(crashDamage(true, false)).toBe(halfEnergy);
    expect(halfEnergy).toBeLessThan(crashDamage(false, false));
  });

  it('leaves NPC crash damage unchanged', () => {
    expect(crashDamage(true, true)).toBe(crashDamage(false, true));
  });
});

describe('crash damage multiplier', () => {
  // Total damage a scout takes from a head-on crash into a rock with the given multiplier.
  function rockCrash(mult: number, impact: number): number {
    const saved = RULES.crashDamage;
    (RULES as { crashDamage: number }).crashDamage = mult;
    try {
      const world = emptyWorld();
      const vehicle = world.vehicles[0];
      const before = mountedParts(vehicle).reduce((sum, part) => sum + part.hp, 0);
      applyContactCrash(world, vehicle, null, 'rock', impact, { a: { side: 'front', lanes: [1, 2, 3] }, b: null });
      return before - mountedParts(vehicle).reduce((sum, part) => sum + part.hp, 0);
    } finally {
      (RULES as { crashDamage: number }).crashDamage = saved;
    }
  }

  // Crash energy grows with the square of the impact, so half the multiplier equals the impact over the square root of 2.
  it('acts on crash energy like a slower impact', () => {
    expect(rockCrash(0.5, 8)).toBe(rockCrash(1, 8 / Math.SQRT2));
    expect(rockCrash(0.5, 8)).toBeLessThan(rockCrash(1, 8));
  });
});
