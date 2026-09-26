import { DETECT } from '../data/detect';
import { sunAt } from './sun';
import { TIME } from '../data/time';
import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld } from './testkit';
import { advanceDust, cloudsSeenBy, contactsOf, dustRange, scannerRange, soundRange } from './detect';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { TERRAIN } from '../data/terrain';
import { dist } from './vec';
import { refreshVision } from './vision';

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
    refreshVision(w); // the stored view was taken before the hill rose
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
    refreshVision(w); // the stored view was taken before the hill rose
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

describe('dust clouds', () => {
  // A daylight world with a dusty raider moving east at speed 4, 30 tiles from the observer.
  function dustyWorld() {
    const w = emptyWorld({ x: 10, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    v.heading = 0;
    v.trail = [0, 1, 2, 3, 4].map((i) => ({ x: 36 + i, y: 30, heading: 0 })); // drove east into x=40 this turn
    w.terrain.types.fill('sand'); // test ground is road, which raises little dust
    expect(dustRange(w, v)).toBeGreaterThan(40);
    return { w, v, observer: w.vehicles[0] };
  }

  it('a moving dusty truck raises a cloud behind it, and a parked one does not', () => {
    const { w, v } = dustyWorld();
    advanceDust(w);
    expect(w.dustClouds.filter((c) => c.source === v.id)).toHaveLength(1);
    expect(w.dustClouds[0].pos.x).toBeLessThan(v.pos.x);
    v.speed = 0;
    advanceDust(w);
    expect(w.dustClouds.filter((c) => c.source === v.id)).toHaveLength(1);
  });

  it('clouds drift back the way the truck came and are gone after their lifetime', () => {
    const { w, v } = dustyWorld();
    advanceDust(w);
    v.speed = 0;
    const start = { ...w.dustClouds[0].pos };
    advanceDust(w);
    expect(w.dustClouds[0].pos.x).toBeLessThan(start.x); // the truck heads east, so its dust drifts west
    for (let t = 0; t < DETECT.dust.lifetime; t++) advanceDust(w);
    expect(w.dustClouds).toHaveLength(0);
  });

  it('a fresh cloud stays hidden beyond sight until it has risen', () => {
    const { w, v, observer } = dustyWorld();
    advanceDust(w);
    v.speed = 0;
    expect(cloudsSeenBy(w, observer)).toHaveLength(0);
    for (let t = 0; t < DETECT.dust.riseTurns; t++) advanceDust(w);
    expect(cloudsSeenBy(w, observer)).toHaveLength(1);
  });

  it('a dust contact circle still holds the true position after the truck moves on', () => {
    const { w, v, observer } = dustyWorld();
    for (let t = 0; t <= DETECT.dust.riseTurns; t++) advanceDust(w);
    v.pos = { x: 48, y: 36 };
    v.speed = 0; // silent now, so only its dust gives it away
    const c = contactsOf(w, observer, Infinity).find((x) => x.vehicleId === v.id)!;
    expect(c.sources).toEqual(['dust']);
    expect(dist(c.center, v.pos)).toBeLessThanOrEqual(c.radius);
  });
});
