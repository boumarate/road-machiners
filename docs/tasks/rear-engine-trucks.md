# Rear-engine trucks

**Status:** reviewing
**Branch:** rear-engine-trucks
**Worktree:** .worktrees/rear-engine-trucks
**Goal:** Four new chassis with the engine behind the driver are for sale in towns and driven by NPCs, each drawn from a base model copying a real vehicle. `npm test` and `npm run playtest` pass, and the user confirms the looks from in-game screenshots.
**Mode:** hands-off

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

Bus, `bus`, tier 2, 6x12. Copies the LAZ-695 city bus: rounded nose, window band, rear engine. Guns and frames stand on the roof, which is one deck. Slow, long and roomy, with the mid-weight drive parts. The driver uses `cabNarrow` at the front left.
```
.FFFF.   cabNarrow at 1,1
XXDDDX   tankMid at 2,7
LXDDDR   transmissionMid at 3,8
LDDDDR
LDDDDR
LDDDDR
LDDDDR
LDXXDR
LDDXDR
LDEEDR   wheels on rows 1 and 10, since bodyOf() needs mirrored wheel rows
XDEEDX
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

## Plan

Approach: I do the data and wiring in PH1. Four implementers each write one base model in parallel, PH2 to PH5. The models read the grid and body numbers from IF1 and own disjoint files.

### PH1 — Chassis data and wiring
- 1.1 `src/data/chassis.ts:36` — add `'jeep' | 'convertible' | 'bus' | 'loader'` to `ChassisDef.look`.
- 1.2 `src/data/chassis.ts:233` — add the four chassis with the design layouts and cores and these numbers. Values land mid-band: 2036, 3212, 3620 and 4808.
  - jeep: maxSpeed 8.2, accel 2.5, brake 3, turn 115/42, reverse 80, mass 450, rated 1400, radius 0.55, fuel 35 at 0.2, base 900, tier 1.
  - convertible: maxSpeed 9.4, accel 2.5, brake 3, turn 110/40, reverse 70, mass 750, rated 2000, radius 0.6, fuel 45 at 0.26, base 1500, tier 2.
  - bus: maxSpeed 5.5, accel 0.9, brake 2, turn 65/22, reverse 40, mass 3000, rated 6800, radius 0.9, fuel 110 at 0.45, base 1200, tier 2. Mid drive parts.
  - loader: maxSpeed 3.6, accel 1.6, brake 2.5, turn 85/30, reverse 60, mass 4200, rated 7000, radius 0.9, fuel 130 at 0.65, base 2600, tier 3. Heavy drive parts.
- 1.3 `src/data/chassis.ts:240` — append the four ids to `PLAYER_CHASSIS`.
- 1.4 `src/data/parts.ts:826-850` — add `cabOpen`: 3x2, not tall, otherwise like `cabPickup`. Update the cab comments for the jeep, bus and loader.
- 1.5 `src/data/physics.ts:30-40` — add the four bodies from IF1.
- 1.6 `src/render/partLooks.ts:9-19` and `src/three/render/models.ts:9-19` — add `base_jeep`, `base_convertible`, `base_bus` and `base_loader`.
- 1.7 `src/data/sounds.ts:106-130` — engines: jeep engine-1, convertible engine-2, bus and loader engine-3. Horns: jeep horn-1 at 1.08, convertible horn-2 at 1.28, bus horn-2 at 0.72, loader horn-1 at 0.72.
- 1.8 `src/data/npcs.ts:119-420` — jeep weight 3 for outriders and 2 for scavengers. Convertible 3 for couriers. Roamers get a convertible at 1 and a jeep at 1. Bus 2 for traders and 2 for convoys. Loader 1 for gunwagons and 2 for Bowl patrols.
- 1.9 `src/data/content.test.ts:46,99-100,122` and `src/phys/content.test.ts:13` — add the four ids and raise the counts to 13 chassis and 11 buyable.
- 1.10 A test in `src/data/content.test.ts` checks IV1: every `E` cell of the four new chassis lies on a row after the last cab row.
- 1.11 `DESIGN.md:256` — list the four new buyable chassis.
- Respects: IV1, IV2, IV3.
- Commit: Add the jeep, convertible, bus and loader chassis with rear engines.

### PH2 to PH5 — Base models
One phase per chassis: PH2 jeep, PH3 convertible, PH4 bus, PH5 loader. Each phase owns `tools/blender/base_<id>.py` and `public/models/base_<id>.glb`.
- Build the design's real vehicle in the style of `base_scout.py` on `parts_common_base.py`, with a `SEED` no other base uses.
- Grid and body come from IF1. Wheels sit on the rows of the wheel cores.
- The engine bay is a cutout behind the cab over the `E` cells, with `floor` sockets at the bay floor like `base_carrier.py`.
- Open cabs show seats and no roof. The bus and loader have closed roofs.
- Bus: `row` sockets on the roof for every cell. Loader: bucket and lift arms drawn on row 0, inside the footprint.
- Render the preview to `tmp/base_<id>.png` and look at it. `check_base()` passes (IV4).
- Respects: IV4, PC1.
- Commit: Add a stylized base model for the <id>: a <real vehicle>.

### Test strategy
- `npm test` covers IV1 to IV3. `npm run typecheck` covers the look union.
- Verify boots the game, buys each chassis with the console, screenshots it and runs `npm run playtest`.

### Risks / rollback
- RK1 — The tall bus collider may tip in turns (AS1). The physics test drives it. If it tips, lower `halfHeight` and keep the drawn roof above the collider.
- RK2 — `cabOpen` may need a rule beyond `tall: false` (UK1). Verify fires a gun across the convertible seats.

### Interfaces
- IF1 — Grid and body per chassis, as cols x rows, then halfHeight, wheelY, wheelRadius and wheelHalfWidth in meters:
  - jeep 4x7: 0.4, -0.25, 0.45, 0.18.
  - convertible 5x9: 0.35, -0.2, 0.42, 0.17.
  - bus 6x12: 0.8, -0.55, 0.55, 0.22.
  - loader 7x9: 0.65, -0.45, 0.8, 0.32.

### Interface graph
- PH1 -> IF1 @ src/, DESIGN.md
- PH2 IF1 -> @ tools/blender/base_jeep.py, public/models/base_jeep.glb
- PH3 IF1 -> @ tools/blender/base_convertible.py, public/models/base_convertible.glb
- PH4 IF1 -> @ tools/blender/base_bus.py, public/models/base_bus.glb
- PH5 IF1 -> @ tools/blender/base_loader.py, public/models/base_loader.glb

## Verify
- `npm test`: 1667 of 1668 pass. The one failure is the AI oncoming test under Deferred.
- The typecheck, the data tests and the physics upright drive pass for all four (IV1 to IV3, AS1 held).
- A new armor test fires a gun behind the convertible seats forward across them. `tall: false` is enough (UK1 resolved).
- In-game shots at 10 am from the rear three-quarter, in `tmp/rear-{jeep,convertible,bus,loader}.png` by `tmp/rear-shots.mjs`: each reads as its vehicle, with the engine showing at the back. No page errors.
- The bus could not mount any 2x2 cargo frame while it had the aisle. Fixed, see Hands-off decisions.
- `npm run playtest` fails with "expected turn 13, got 12" on this branch and on main alike, so the fault is older than this branch.

## Conclusion

### Hands-off decisions
- size: medium — four chassis plus four models.
- branch: rear-engine-trucks in .worktrees/rear-engine-trucks.
- uplan: plan approved by the user, hands-off from execute on.
- prices: set in PH1 as asked, then moved to pass the rule that more deck cells never cost less in a tier. Jeep 2336, convertible 3112, bus 3920, loader 5208.
- bus aisle: the plain aisle cells left no 2x2 deck block, so no cargo frame fit. The whole roof is deck now, with the base lowered to keep the price at 3920.

### Deferred (needs user input)
- `npm run playtest` fails on main too: "expected turn 13, got 12", 3 runs out of 3 here and 1 out of 1 on main.
- `src/phys/ai.test.ts` "passes the oncoming player" fails on this branch. With the old NPC tables it passes, so the new spawn weights only shift world RNG. Under the new rolls the trader comes within 1.0 tiles of the oncoming player and slows to 0.48, under `RULES.parkedSpeed`. That is the old head-on dodge failing for this seed, not the new trucks. Fixing the dodge or reseeding the test is your call.
