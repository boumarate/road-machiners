// Light from the clock. The sun moves continuously: white at noon, gold in the late afternoon,
// red at the horizon with long shadows, then a short twilight hands over to blue moonlight.

import * as THREE from 'three';
import { TERRAIN } from '../../data/terrain';
import { TIME } from '../../data/time';
import { clockOf } from '../../sim/sun';
import type { Vec } from '../../sim/vec';

const DEG = Math.PI / 180;
const MIN_LIGHT_ELEVATION = 6; // degrees; a lower light would stretch every shadow across the whole view
const TWILIGHT = 10; // degrees below the horizon where the handover to moonlight ends
const MOON_ELEVATION = 25; // degrees
const MOON_DIR = TERRAIN.light;

// Keyed by the sun's height in degrees, highest first. Negative is below the horizon.
type Key = { h: number; sun: number; sunI: number; sky: number; ground: number; skyI: number };
const KEYS: Key[] = [
  { h: 45, sun: 0xfff0d0, sunI: 2.2, sky: 0xfff0d8, ground: 0x6a5038, skyI: 1.4 },
  { h: 20, sun: 0xffe0b0, sunI: 2.1, sky: 0xffe8cc, ground: 0x6a5038, skyI: 1.3 },
  { h: 8, sun: 0xffa860, sunI: 1.9, sky: 0xf0b890, ground: 0x5a4030, skyI: 1.1 },
  { h: 1, sun: 0xff5030, sunI: 1.5, sky: 0xc07868, ground: 0x3a2a28, skyI: 0.85 },
  { h: -4, sun: 0xa04050, sunI: 0.6, sky: 0x7a6080, ground: 0x241e2a, skyI: 0.55 },
  { h: -TWILIGHT, sun: 0x8090c0, sunI: 0.12, sky: 0x5a6c9c, ground: 0x1c1e2a, skyI: 0.2 },
];

export type Daylight = {
  dir: Vec; // unit map direction toward the light
  elevation: number; // radians
  sun: THREE.Color;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  skyIntensity: number;
};

// The sun's height in degrees. At night it keeps sinking at its horizon rate, so twilight has a length.
function sunHeight(hour: number): { h: number; dir: Vec } {
  const span = TIME.sunset - TIME.sunrise;
  const t = (hour - TIME.sunrise) / span;
  if (t >= 0 && t <= 1) {
    return { h: Math.sin(Math.PI * t) * TIME.noonElevation, dir: { x: Math.cos(Math.PI * t), y: Math.sin(Math.PI * t) } };
  }
  const rate = (TIME.noonElevation * Math.PI) / span; // degrees per hour at the horizon
  const afterSunset = (hour - TIME.sunset + 24) % 24;
  const beforeSunrise = (TIME.sunrise - hour + 24) % 24;
  const evening = afterSunset < beforeSunrise;
  return { h: -Math.min(afterSunset, beforeSunrise) * rate, dir: evening ? { x: -1, y: 0 } : { x: 1, y: 0 } };
}

function colorsAt(h: number): Omit<Daylight, 'dir' | 'elevation'> {
  // Past either end the light holds the end key, so deep night never extrapolates.
  const hi = KEYS.findIndex((k) => k.h <= h);
  const a = hi === -1 ? KEYS[KEYS.length - 1] : KEYS[Math.max(0, hi - 1)];
  const b = hi === -1 ? a : KEYS[hi];
  const s = a === b ? 0 : (a.h - h) / (a.h - b.h);
  const mix = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), s);
  return {
    sun: mix(a.sun, b.sun),
    sunIntensity: a.sunI + (b.sunI - a.sunI) * s,
    sky: mix(a.sky, b.sky),
    ground: mix(a.ground, b.ground),
    skyIntensity: a.skyI + (b.skyI - a.skyI) * s,
  };
}

export function daylightAt(turn: number): Daylight {
  const { h, dir } = sunHeight(clockOf(turn).hour);
  const colors = colorsAt(h);
  if (h >= 0) return { ...colors, dir, elevation: Math.max(h, MIN_LIGHT_ELEVATION) * DEG };
  // Below the horizon the light swings from the set sun to the moon while it is dim.
  const s = Math.min(1, -h / TWILIGHT);
  const x = dir.x + (MOON_DIR.x - dir.x) * s;
  const y = dir.y + (MOON_DIR.y - dir.y) * s;
  const len = Math.hypot(x, y);
  const elevation = MIN_LIGHT_ELEVATION + (MOON_ELEVATION - MIN_LIGHT_ELEVATION) * s;
  return { ...colors, dir: { x: x / len, y: y / len }, elevation: elevation * DEG };
}
