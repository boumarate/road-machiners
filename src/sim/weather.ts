// Weather events that change the rules. weatherAt is the single query every effect reads.

import type { World } from './types';
import type { Vec } from './vec';

// Multipliers on sight radius, top speed, wear and heat, and extra scatter in radians.
export type WeatherEffects = { sight: number; spread: number; speed: number; wear: number; heat: number };

export function advanceWeather(_world: World): void {}

export function weatherAt(_world: World, _pos: Vec): WeatherEffects {
  return { sight: 1, spread: 0, speed: 1, wear: 1, heat: 1 };
}
