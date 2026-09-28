import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { HAZE_FROM } from '../../data/wear';
import { sunAt, sunHeatAt } from '../../sim/sun';
import { emptyWorld } from '../../sim/testkit';
import { cornerLook } from './shade';

function turnFor(hour: number): number {
  return 1 + ((hour - TIME.startHour) * TIME.turnsPerDay) / 24;
}

describe('heat haze', () => {
  const noon = (TIME.sunrise + TIME.sunset) / 2;

  it('shimmers at full strength on open ground at noon in a heat wave', () => {
    const w = emptyWorld();
    w.turn = turnFor(noon);
    w.weather = [{ id: 'hw', kind: 'heatwave', turnsLeft: 10 }];
    const { x, y } = w.vehicles[0].pos;
    expect(cornerLook(w, x, y, sunAt(w.turn)!).haze).toBe(255);
  });

  it('does not shimmer in sun too weak to heat a driving engine', () => {
    const w = emptyWorld();
    w.turn = turnFor(TIME.sunrise + 1);
    const { x, y } = w.vehicles[0].pos;
    const sun = sunAt(w.turn)!;
    expect(sunHeatAt(w, { x, y }, sun)).toBeLessThan(HAZE_FROM);
    expect(cornerLook(w, x, y, sun).haze).toBe(0);
  });

  it('does not shimmer in shade', () => {
    const w = emptyWorld();
    w.turn = turnFor(noon);
    const sun = sunAt(w.turn)!;
    const { x, y } = w.vehicles[0].pos;
    const heights = [...w.terrain.heights];
    const size = w.terrain.size;
    const bx = Math.round(x + sun.dir.x * 3);
    const by = Math.round(y + sun.dir.y * 3);
    for (let j = by - 1; j <= by + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) heights[j * (size + 1) + i] = 50;
    w.terrain = { ...w.terrain, heights };
    expect(cornerLook(w, x, y, sun).haze).toBe(0);
  });
});
