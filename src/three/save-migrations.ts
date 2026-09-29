// The save format and the steps that carry an old save to it. A save loads only in its own major format. Within
// it, load runs every step from the save's minor format on, so the minor format is the number of steps.

import { coreParts } from './save-migration-core-parts';
import { longWheels } from './save-migration-long-wheels';
import { armorSkin } from './save-migration-skin';
import { wheelsInside } from './save-migration-wheels';

// A saved world as raw JSON. Steps read it without game types, since those change after a step is written.
export type SavedJson = Record<string, unknown>;

// Bump for a change old saves cannot follow, like a new map, and empty MIGRATIONS with it. Players start a new game.
export const SAVE_MAJOR = 1;

// MIGRATIONS[n] turns a saved world of minor format n into minor format n + 1. A step is pure and imports no sim
// or data code, and a committed step is never edited.
export const MIGRATIONS: readonly ((world: SavedJson) => SavedJson)[] = [gunMagazines, wheelsInside, armorSkin, longWheels, coreParts];

export const SAVE_FORMAT = { major: SAVE_MAJOR, minor: MIGRATIONS.length } as const;

// 1.0 to 1.1: guns fire from magazines. A weapon part's reload counter becomes the cooldown of a full magazine, and
// every other part drops the counter. Magazine sizes are the ones the seven guns of format 1.0 got.
const MAGAZINES_1_1: Record<string, number> = { mg: 5, cannon: 2, shotgun: 2, autocannon: 4, tankGun: 2, rocketRack: 1, sniperCannon: 3 };

function gunMagazines(world: SavedJson): SavedJson {
  return mapParts(world, (part) => {
    const { reload, ...rest } = part;
    if (typeof reload !== 'number') throw new Error(`Saved part ${String(part.id)} has no reload counter`);
    const magazine = MAGAZINES_1_1[String(part.defId)];
    return magazine === undefined ? rest : { ...rest, gun: { cooldown: reload, ammo: magazine, reloadWork: 0 } };
  }) as SavedJson;
}

// Every part instance anywhere in the saved world, found by its id, defId, hp and wear fields, passed through f.
function mapParts(value: unknown, f: (part: SavedJson) => SavedJson): unknown {
  if (Array.isArray(value)) return value.map((x) => mapParts(x, f));
  if (!value || typeof value !== 'object') return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapParts(v, f)]));
  return isPart(mapped) ? f(mapped) : mapped;
}

function isPart(o: SavedJson): boolean {
  return ['id', 'defId', 'hp', 'wear'].every((k) => k in o);
}
