// Fills dialogue lines with call values in real units.

import { REGION } from '../data/region';
import type { CallVar, CallVars } from '../sim/types';
import { meters } from './units';

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const METERS_PER_KM = 1000;

// Map +x is east and +y is south, so a bearing of 0 points east and turns clockwise.
function compass(rad: number): string {
  const step = (2 * Math.PI) / COMPASS.length;
  const i = Math.round(rad / step);
  return COMPASS[((i % COMPASS.length) + COMPASS.length) % COMPASS.length];
}

function townName(id: string): string {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town.name;
}

function distanceText(tiles: number): string {
  const m = meters(tiles);
  return m >= METERS_PER_KM ? `${(m / METERS_PER_KM).toFixed(1)} km` : `${m} m`;
}

function formatVar(v: CallVar): string {
  switch (v.kind) {
    case 'town': return townName(v.id);
    case 'money': return String(v.amount);
    case 'distance': return distanceText(v.tiles);
    case 'bearing': return compass(v.rad);
    case 'count': return String(v.n);
  }
}

export function fillLine(text: string, vars: CallVars): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    if (!v) throw new Error(`Line "${text}" needs the call value ${name}`);
    return formatVar(v);
  });
}
