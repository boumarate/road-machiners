// Time of day and the sun. Pure functions of the turn number.

import { TIME } from '../data/time';
import type { Vec } from './vec';

// dir is the unit map direction toward the sun. elevation is its height above the horizon in radians.
export type Sun = { dir: Vec; elevation: number };

export function clockOf(turn: number): { day: number; hour: number } {
  const hours = TIME.startHour + ((turn - 1) * 24) / TIME.turnsPerDay;
  return { day: Math.floor(hours / 24) + 1, hour: hours % 24 };
}

// The sun rises in the east (+x), crosses the south (+y) at noon and sets in the west. Null at night.
export function sunAt(turn: number): Sun | null {
  const { hour } = clockOf(turn);
  if (hour <= TIME.sunrise || hour >= TIME.sunset) return null;
  const t = (hour - TIME.sunrise) / (TIME.sunset - TIME.sunrise);
  const elevation = Math.sin(Math.PI * t) * TIME.noonElevation * (Math.PI / 180);
  return { dir: { x: Math.cos(Math.PI * t), y: Math.sin(Math.PI * t) }, elevation };
}
