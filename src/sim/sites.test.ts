import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { clickOrder } from './steering';
import { canUseSite, nearestPad, siteGates, sitePads, siteUnder } from './sites';
import { dist } from './vec';

const SITES = [...REGION.towns, ...REGION.locations];
const PAD = REGION.sites.pad;

describe('site gates and pads', () => {
  it('gives every site a gate on its edge', () => {
    for (const site of SITES) {
      const gates = siteGates(site);
      expect(gates.length, site.id).toBeGreaterThan(0);
      for (const gate of gates) expect(dist(gate, site.pos), site.id).toBeCloseTo(site.radius, 6);
    }
  });

  it('puts each pad outside its site, touching the gate', () => {
    for (const site of SITES) {
      const gates = siteGates(site);
      sitePads(site).forEach((pad, i) => {
        expect(dist(pad, site.pos), site.id).toBeCloseTo(site.radius + PAD.length / 2, 6);
        expect(dist(pad, gates[i]), site.id).toBeCloseTo(PAD.length / 2, 6);
      });
    }
  });

  it('lets a truck use a site only on a pad', () => {
    for (const site of SITES) {
      const pad = sitePads(site)[0];
      const a = Math.atan2(pad.y - site.pos.y, pad.x - site.pos.x);
      const at = (along: number, across: number) => ({
        x: pad.x + Math.cos(a) * along - Math.sin(a) * across,
        y: pad.y + Math.sin(a) * along + Math.cos(a) * across,
      });
      expect(canUseSite(pad, site), site.id).toBe(true);
      expect(canUseSite(at(PAD.length / 2 - 0.01, PAD.width / 2 - 0.01), site), site.id).toBe(true);
      expect(canUseSite(at(PAD.length / 2 + 0.01, 0), site), site.id).toBe(false);
      expect(canUseSite(at(0, PAD.width / 2 + 0.01), site), site.id).toBe(false);
    }
  });

  it('refuses use from beside an open site, away from its gates', () => {
    const oasis = REGION.locations.find((l) => l.kind === 'oasis')!;
    const gateAngles = siteGates(oasis).map((g) => Math.atan2(g.y - oasis.pos.y, g.x - oasis.pos.x));
    // The edge point farthest in angle from every gate.
    let best = 0;
    let bestGap = -1;
    for (let a = -Math.PI; a < Math.PI; a += 0.01) {
      const gap = Math.min(...gateAngles.map((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g)))));
      if (gap > bestGap) [best, bestGap] = [a, gap];
    }
    const beside = { x: oasis.pos.x + Math.cos(best) * (oasis.radius + 1), y: oasis.pos.y + Math.sin(best) * (oasis.radius + 1) };
    expect(canUseSite(beside, oasis)).toBe(false);
  });

  it('finds the pad nearest a point', () => {
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    for (const pad of sitePads(nose)) {
      const near = { x: pad.x + 1, y: pad.y };
      expect(nearestPad(nose, near)).toEqual(pad);
    }
  });
});

describe('clicks on a site', () => {
  it('finds the site under a point', () => {
    const bowl = REGION.towns[0];
    expect(siteUnder(bowl.pos)?.id).toBe(bowl.id);
    expect(siteUnder(sitePads(bowl)[0])).toBeNull();
  });

  it('turns a click inside a site into a stop at its pad nearest the truck', () => {
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    const pad = sitePads(nose)[1];
    const from = { x: pad.x + 20 * (pad.x - nose.pos.x) / dist(pad, nose.pos), y: pad.y + 20 * (pad.y - nose.pos.y) / dist(pad, nose.pos) };
    expect(clickOrder(nose.pos, false, { pos: from, order: null })).toEqual({ kind: 'stopAt', dest: pad });
  });

  it('keeps a click on open ground as a drive-through order', () => {
    const dest = { x: 5, y: 5 };
    expect(siteUnder(dest)).toBeNull();
    expect(clickOrder(dest, false, { pos: { x: 1, y: 1 }, order: null })).toEqual({ kind: 'through', dest });
  });
});
