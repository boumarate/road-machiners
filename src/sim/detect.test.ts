import { DETECT } from '../data/detect';
import { sunAt } from './sun';
import { TIME } from '../data/time';
import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld } from './testkit';
import { contactsOf, dustRange, scannerRange, soundRange } from './detect';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { TERRAIN } from '../data/terrain';
import { dist } from './vec';

// Raises a small hill between x=32 and x=36 at y=30, tall enough to block a plain sight line
// but not the wider systems (sound, radio) that ignore hills.
function raiseHill(w: ReturnType<typeof emptyWorld>): void {
  const size = w.terrain.size;
  for (let i = 32; i <= 36; i++) for (let j = 28; j <= 32; j++) w.terrain.heights[j * (size + 1) + i] = 3;
}

describe('soundRange and dustRange', () => {
  it('a parked truck is silent and dustless', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 0;
    expect(soundRange(w, v)).toBe(0);
    expect(dustRange(w, v)).toBe(0);
  });

  it('a road raises less dust than sand', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    const idx = Math.floor(v.pos.y) * w.terrain.size + Math.floor(v.pos.x);
    w.terrain.types[idx] = 'road';
    const onRoad = dustRange(w, v);
    w.terrain.types[idx] = 'sand';
    const onSand = dustRange(w, v);
    expect(onRoad).toBeLessThan(onSand);
  });

  it('own speed shortens hearing', () => {
    const w = emptyWorld({ x: 2, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!; // night: no dust
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 2, y: 30 });
    target.speed = 2;
    observer.speed = 2;
    // Just inside plain hearing range, but past what a listener moving at speed 2 can hear.
    target.pos = { x: 2 + soundRange(w, target) - DETECT.sound.ownPenalty, y: 30 };
    expect(target.pos.x).toBeLessThan(w.size);
    const movingContacts = contactsOf(w, observer, Infinity);
    expect(movingContacts.find((c) => c.vehicleId === target.id)).toBeUndefined();
    observer.speed = 0;
    const parkedContacts = contactsOf(w, observer, Infinity);
    expect(parkedContacts.find((c) => c.vehicleId === target.id)?.sources).toContain('sound');
  });

  it('night hides dust', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    expect(dustRange(w, v)).toBe(0);
  });
});

describe('hills and the scanner', () => {
  it('a hill blocks sight but not sound', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    raiseHill(w);
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    target.speed = 4;
    const contacts = contactsOf(w, observer, Infinity);
    const contact = contacts.find((c) => c.vehicleId === target.id);
    expect(contact?.sources).toContain('sound');
    expect(contact?.sources).not.toContain('dust'); // taller terrain than the dust eye height blocks it too
  });

  it('the scanner works through hills', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    raiseHill(w);
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    target.speed = 0.2; // below the parked threshold used by sound, so only the scanner should trigger
    expect(scannerRange(observer)).toBe(0);
    const before = contactsOf(w, observer, Infinity);
    expect(before.find((c) => c.vehicleId === target.id)).toBeUndefined();
    if (!mountPart(w, observer, makePart(w, 'scanner'))) throw new Error('No free mount for the test scanner');
    target.speed = 4;
    expect(scannerRange(observer)).toBeGreaterThan(0);
    const after = contactsOf(w, observer, Infinity);
    expect(after.find((c) => c.vehicleId === target.id)?.sources).toContain('radio');
  });
});

describe('contact fuzz', () => {
  it('the circle always holds the true position', () => {
    const w = emptyWorld({ x: 20, y: 30 });
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 31, y: 30 });
    target.speed = 3;
    for (let seed = 1; seed <= 50; seed++) {
      for (let turn = 1; turn <= 5; turn++) {
        w.seed = seed;
        w.turn = turn;
        const contacts = contactsOf(w, observer, Infinity);
        const contact = contacts.find((c) => c.vehicleId === target.id);
        if (!contact) continue; // some combinations of seed/turn do not change detection, only the fuzz
        expect(dist(contact.center, target.pos)).toBeLessThanOrEqual(contact.radius);
      }
    }
  });
});

describe('sight radius stays 10 tiles', () => {
  it('matches TERRAIN.vision.radius', () => {
    expect(TERRAIN.vision.radius).toBe(10);
  });
});
