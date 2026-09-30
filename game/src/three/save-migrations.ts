// The save format and the steps that carry an old save to it. A save loads only in its own major format. Within
// it, load runs every step from the save's minor format on, so the minor format is the number of steps.

// A saved world as raw JSON. Steps read it without game types, since those change after a step is written.
export type SavedJson = Record<string, unknown>;

// Bump for a change old saves cannot follow, like a new map, and empty MIGRATIONS with it. Players start a new game.
export const SAVE_MAJOR = 2;

// Step 1 to 2: the scout's grid gained a column at INSERT_AT, and its cab and transmission moved right. Cargo rows lie
// below the chassis rows. The cab and transmission are fixed core parts that players never move, so a match by id and cell is safe.
const SCOUT = 'scout';
const INSERT_AT = 4;
const CHASSIS_ROWS = 8;
const MOVED_CORE: Record<string, { from: { x: number; y: number }; to: { x: number; y: number } }> = {
  cabPickup: { from: { x: 1, y: 3 }, to: { x: 2, y: 3 } },
  transmission: { from: { x: 2, y: 5 }, to: { x: 3, y: 5 } },
};

type Spot = SavedJson & { x: number; y: number };

function movedCore<T extends Spot>(spot: T, defId?: string): T | null {
  const core = defId ? MOVED_CORE[defId] : undefined;
  return core && spot.x === core.from.x && spot.y === core.from.y ? { ...spot, ...core.to } : null;
}

function shiftSpot<T extends Spot>(spot: T, defId?: string): T {
  const core = movedCore(spot, defId);
  if (core) return core;
  return spot.y < CHASSIS_ROWS && spot.x >= INSERT_AT ? { ...spot, x: spot.x + 1 } : spot;
}

function shiftScout(vehicle: SavedJson): SavedJson {
  if (vehicle.chassisId !== SCOUT) return vehicle;
  const items = (vehicle.items as (Spot & { part?: { defId: string } })[]).map((item) => shiftSpot(item, item.part?.defId));
  const job = vehicle.job as (SavedJson & { kind: string; moves: SavedJson[]; pickup: SavedJson | null }) | null;
  if (!job || job.kind !== 'refit') return { ...vehicle, items };
  const moves = job.moves.map((move) => ({ ...move, from: shiftSpot(move.from as Spot), to: shiftSpot(move.to as Spot) }));
  const pickup = job.pickup && { ...job.pickup, to: shiftSpot(job.pickup.to as Spot) };
  return { ...vehicle, items, job: { ...job, moves, pickup } };
}

// MIGRATIONS[n] turns a saved world of minor format n into minor format n + 1. A step is pure and imports no sim
// or data code, and a committed step is never edited.
export const MIGRATIONS: readonly ((world: SavedJson) => SavedJson)[] = [
  // 0 to 1: the player gets townPatched, as a new game does.
  (world) => ({ ...world, player: { ...(world.player as SavedJson), townPatched: false } }),
  // 1 to 2: the scout grid gains column 4; the cab and transmission move right one.
  (world) => ({
    ...world,
    vehicles: (world.vehicles as SavedJson[]).map(shiftScout),
    removed: (world.removed as SavedJson[]).map(shiftScout),
  }),
];

export const SAVE_FORMAT = { major: SAVE_MAJOR, minor: MIGRATIONS.length } as const;
