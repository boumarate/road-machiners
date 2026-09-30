// The save format and the steps that carry an old save to it. A save loads only in its own major format. Within
// it, load runs every step from the save's minor format on, so the minor format is the number of steps.

// A saved world as raw JSON. Steps read it without game types, since those change after a step is written.
export type SavedJson = Record<string, unknown>;

// Bump for a change old saves cannot follow, like a new map, and empty MIGRATIONS with it. Players start a new game.
export const SAVE_MAJOR = 2;

// Step 1 to 2: the scout's cab moves from (1,3) to (2,3). What stood on the new cab cells (2..4, 3..4) moves to
// column 1 or leaves the grid. Parts are 1x1 unless listed here, a copy of the sizes at format 2.1 since the parts
// table changes later.
const SIZES_2_1: Record<string, readonly [number, number]> = {
  shotgun: [1, 2],
  longRifle: [1, 2],
  flamer: [1, 2],
  pneumobolter: [2, 2],
  slugCannon: [1, 2],
  heavyMg: [1, 2],
  cannon: [2, 2],
  amRifle: [1, 3],
  autocannon: [2, 2],
  recoilless: [1, 3],
  battleRifle: [1, 3],
  gatling: [2, 2],
  rocketRack: [2, 2],
  sniperCannon: [2, 3],
  grenadeLauncher: [2, 2],
  tankGun: [2, 3],
  flechette: [2, 2],
  stockEngine: [2, 2],
  tunedEngine: [2, 2],
  flatFour: [2, 2],
  workhorseDiesel: [2, 2],
  racingV6: [2, 2],
  heavyDiesel: [2, 2],
  turbine: [2, 2],
  plates: [1, 3],
  cage: [1, 2],
  ram: [3, 1],
  scrapPanels: [1, 2],
  ceramicPlates: [1, 2],
  spacedArmor: [1, 4],
  reinforcedCage: [1, 3],
  plowRam: [3, 1],
  rack: [2, 1],
  trailerBox: [2, 2],
  flatbed: [2, 1],
  lightFrame: [2, 2],
  enclosedFrame: [2, 2],
  heavyFrame: [2, 2],
};

type Cell = { x: number; y: number };
type Item = SavedJson & { x: number; y: number; rot: number; part?: SavedJson & { defId: string } };

const CAB_CELLS = [2, 3, 4].flatMap((x) => [3, 4].map((y) => ({ x, y })));

function cellsOf(item: Item): Cell[] {
  const [w, h] = (item.part && SIZES_2_1[item.part.defId]) || [1, 1];
  const [across, along] = item.rot === 1 ? [h, w] : [w, h];
  return Array.from({ length: across * along }, (_, i) => ({ x: item.x + (i % across), y: item.y + Math.floor(i / across) }));
}

const onNewCab = (item: Item) => cellsOf(item).some((c) => CAB_CELLS.some((k) => k.x === c.x && k.y === c.y));

const isOldCab = (item: Item) => item.part?.defId === 'cabPickup' && item.x === 1 && item.y === 3;

// A one cell wide item anchored at (4,3) or (4,4) slides to column 1.
function slidesToColumn1(item: Item): boolean {
  const narrow = cellsOf(item).every((c) => c.x === item.x);
  return item.x === 4 && (item.y === 3 || item.y === 4) && narrow;
}

// Anything else on the new cab is displaced.
function moveItem(item: Item): { item: Item; displaced: boolean } {
  if (isOldCab(item)) return { item: { ...item, x: 2 }, displaced: false };
  if (!onNewCab(item)) return { item, displaced: false };
  return slidesToColumn1(item) ? { item: { ...item, x: 1 }, displaced: false } : { item, displaced: true };
}

function refitScout(vehicle: SavedJson, displaced: SavedJson[]): SavedJson {
  if (vehicle.chassisId !== 'scout') return vehicle;
  const items: Item[] = [];
  for (const item of vehicle.items as Item[]) {
    const moved = moveItem(item);
    if (!moved.displaced) items.push(moved.item);
    else if (item.part) displaced.push(item.part);
  }
  return { ...vehicle, items, job: withoutRefit(vehicle.job) };
}

// Only a refit is tied to the old cells; other jobs do not touch the grid.
function withoutRefit(job: unknown): unknown {
  return (job as SavedJson | null)?.kind === 'refit' ? null : job;
}

// MIGRATIONS[n] turns a saved world of minor format n into minor format n + 1. A step is pure and imports no sim
// or data code, and a committed step is never edited.
export const MIGRATIONS: readonly ((world: SavedJson) => SavedJson)[] = [
  // 0 to 1: the player gets townPatched, as a new game does.
  (world) => ({ ...world, player: { ...(world.player as SavedJson), townPatched: false } }),
  // 1 to 2: the scout's cab moves one column right; what stood on its new cells moves to column 1 or the garage.
  (world) => {
    const player = world.player as SavedJson & { vehicleId: string; storage: SavedJson[] };
    const displaced: SavedJson[] = [];
    const vehicles = (world.vehicles as SavedJson[]).map((v) => refitScout(v, v.id === player.vehicleId ? displaced : []));
    const removed = (world.removed as SavedJson[]).map((v) => refitScout(v, []));
    return { ...world, player: { ...player, storage: [...player.storage, ...displaced] }, vehicles, removed };
  },
];

export const SAVE_FORMAT = { major: SAVE_MAJOR, minor: MIGRATIONS.length } as const;
