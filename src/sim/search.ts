// Scavenging search: a parked job that moves salvage stock into the grid a little each turn.

import type { Job, Vehicle, World } from './types';

export function searchTurn(_world: World, _v: Vehicle, _job: Extract<Job, { kind: 'search' }>): boolean {
  throw new Error('Scavenging search is not built yet');
}
