# Rear-engine trucks

**Status:** design
**Branch:** main
**Worktree:** none
**Goal:** Four new chassis with the engine behind the driver are for sale in towns and driven by NPCs, each drawn from a base model copying a real vehicle. `npm test` and `npm run playtest` pass, and the user confirms the looks from in-game screenshots.
**Mode:** interactive

## Context
- Nine chassis exist in `src/data/chassis.ts`. Every one but the carrier has its engine bay `E` ahead of the cab.
- A chassis touches these places: `CHASSIS` and `PLAYER_CHASSIS`, the `look` union, `PHYSICS.bodies` per look, `BASE_MODELS` in `src/render/partLooks.ts`, `NAMES` in `src/three/render/models.ts`, `ENGINE_FILES` and `HORN_SOUNDS` in `src/data/sounds.ts`, and the NPC template chassis tables in `src/data/npcs.ts`.
- `src/data/content.test.ts` pins the chassis counts, and `src/phys/content.test.ts` drives each added chassis upright.
- A chassis price is a hand-set `base` plus a modifier from deck cells, armor cells and top speed. The effort band test holds tier 1 chassis to 1850 to 2775, and tier 2 and 3 to their own bands.
- Each base model is one Blender script `tools/blender/base_<id>.py` on `parts_common_base.py`, exporting `row` and `floor` sockets per cell. `base_carrier.py` shows an engine cutout behind the front hull.
- Every cab is a core part the base draws. A closed cab is tall and blocks gunfire across it. An open seat is not tall.

## Design
Add four chassis, each copying a real rear-engine vehicle. Layouts put the nose on row 0 and the `E` bay behind the cab.

Jeep, `jeep`, tier 1, 4x7. Copies the VW Kübelwagen Type 82: open body, flat hood with the spare wheel, air-cooled engine under a rear lid. Faster than the scout and slower than the buggy. The driver's `cab` is an open seat, so guns fire across it.
```
.FF.   tank at 1,1
XXDX   cab at 1,2
LXDR   transmission at 2,3, ahead of the engine like the VW transaxle
LDXR
LEER
XEEX
.BB.
```

Convertible, `convertible`, tier 2, 5x9. Copies the 1964 Chevrolet Corvair Monza convertible: long low body, front trunk, open top, flat-six under the rear deck lid. The fastest tier 2 chassis with light cargo room. A new core part `cabOpen`, 3x2 and not tall, is its two seat rows. Guns fire across it.
```
.FFF.   tankLong at 1,2
XDDDX   cabOpen at 1,3
LXXDR   transmission at 2,5
LXXXR
LXXXR
LDXDR
LEEDR
XEEDX
.BBB.
```

Bus, `bus`, tier 2, 6x12. Copies the LAZ-695 city bus: rounded nose, window band, rear engine. Guns and frames stand on the roof. The aisle cells are plain, so they carry goods and spares but mount nothing. Slow, long and roomy, with the mid-weight drive parts. The driver uses `cabNarrow` at the front left.
```
.FFFF.   cabNarrow at 1,1
XXDDDX   tankMid at 2,7
LX..DR   transmissionMid at 3,8
LD..DR
LD..DR
LD..DR
LD..DR
LDXXDR
XDDXDX
LDEEDR
LDEEDR
.BBBB.
```

Loader, `loader`, tier 3, 7x9. Copies the Caterpillar 950 wheel loader: bucket and lift arms on the front row, a boxy cab in the middle, engine hood and counterweight at the back, big tires. The base draws the bucket. Front armor mounts there as on any chassis and covers it. The slowest chassis, with the tightest turn for its size and heavy drive parts. The cab is `cabPickup`, 3x2 and tall.
```
.FFFFF.   cabPickup at 2,2
XDDDDDX   transmissionHeavy at 3,4
LDXXXDR   tankHeavy at 4,6
LDXXXDR
LDDXDDR
LDEEDDR
LDEEXXR
XDDDDDX
.BBBBB.
```

All four are in `PLAYER_CHASSIS`. NPC templates gain them: the jeep for outriders and scavengers, the convertible for couriers and roamers, the bus for traders and convoys, and the loader for gunwagons and Bowl patrols. Each gets a physics body per look, an engine file and a horn pitch no other chassis shares. Speeds, masses and bases are set in the plan and must pass the tier bands.

Each base model follows the house style of `base_scout.py`. Its engine bay is a cutout behind the cab with `floor` sockets at the bay floor, like `base_carrier.py`. Each script is written, rendered and looked at before wiring. The four scripts are independent and are written in parallel.

No saves or consumers break. New ids only add entries.

TDD: no. The change is data and models. The existing content and physics tests cover it once their chassis lists grow.

### Invariants
- IV1 — Every new chassis has its whole `E` bay behind its cab rows.
- IV2 — Every new chassis passes the content tests: core parts mounted, valid placement, body built, price inside its tier band.
- IV3 — Every new chassis drives upright in the physics content test.
- IV4 — Each base model stays inside its grid footprint, checked by `check_base()`.

### Principles
- PC1 — Each base reads as its real vehicle at the default zoom: silhouette and color blocks first, detail last.

### Assumptions
- AS1 — A bus collider with half height near 0.8 m stays upright in turns at its rated mass.

### Unknowns
- UK1 — Whether the open `cabOpen` needs any rule beyond `tall: false`.
