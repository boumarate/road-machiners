// Field repair: a parked job that spends parts to restore one part's HP up to a field cap.

import type { Job, Vehicle, World } from './types';

export function repairTurn(_world: World, _v: Vehicle, _job: Extract<Job, { kind: 'repair' }>): boolean {
  throw new Error('Field repair is not built yet');
}
