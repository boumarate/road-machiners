import { describe, expect, it } from 'vitest';
import { applyContactCrash, computeClosingSpeed, locateCrashContact } from './crash-contact';
import { addVehicle, emptyWorld } from './testkit';
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
    expect(mountedParts(vehicle).find((part) => part.defId === 'ram')?.hp).toBeLessThan(50);
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
