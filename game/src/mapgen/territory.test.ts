import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { TERRITORIES } from '../data/territory';
import { isLootSpot, territoryEntries } from '../sim/territory';
import { propReach } from '../sim/mapgen';
import { route } from '../sim/path';
import { newWorld } from '../sim/world';
import { dist } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { newDraft } from './bake';
import { territoryLayer } from './territory';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const rules = TERRITORIES['fallen-sun'];
const inside = TEST_MAP.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);

describe('the territory layer', () => {
  it('places the same props for the same seed', () => {
    const run = () => territoryLayer(7, newDraft(REGION.size)).props;
    expect(run()).toEqual(run());
    expect(run()).not.toEqual(territoryLayer(8, newDraft(REGION.size)).props);
  });

  it('bakes the spot, debris and reactor counts the data asks for', () => {
    for (const rule of [...rules.spots, ...rules.debris]) {
      expect(inside.filter((p) => p.kind === rule.look).length, rule.look).toBeGreaterThanOrEqual(rule.count);
    }
    expect(inside.filter((p) => p.kind === rules.reactor!.look)).toHaveLength(1);
  });

  it('keeps every spot apart and outside the hazard', () => {
    const spots = inside.filter((p) => rules.spots.some((s) => s.look === p.kind));
    spots.forEach((a, i) => {
      expect(dist(a.pos, fallenSun.pos), a.kind).toBeGreaterThan(rules.hazard!.radius + a.r);
      for (const b of spots.slice(i + 1)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(rules.spotGap);
    });
  });

  it('lets a truck drive from each approach road to the side of every spot', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter(isLootSpot);
    expect(spots.length).toBe(rules.spots.reduce((n, s) => n + s.count, 0));
    for (const entry of territoryEntries(fallenSun as never)) {
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), spot.id).toBeLessThanOrEqual((propReach(spot) + ECONOMY.useRange) * ECONOMY.interactionScale);
      }
    }
  });
});
