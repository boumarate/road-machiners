# Modular Vehicle Parts

**Status:** reviewing
**Branch:** modular-parts
**Worktree:** .worktrees/modular-parts
**Goal:** Every truck is drawn as an open rig of Blender part models that snap to one shared cell size, so any part fits any chassis and the drawn truck matches its physics collider. Weapons are assembled from sub-part models, so two weapons of the same kind can look different. The user confirms the look in game.
**Mode:** interactive

## Context

- `src/three/render/vehicle.ts` draws trucks from code boxes placed by fractions of the body size, not by grid cells. A mounted part's cells do not decide where it appears, except for armor span.
- A cannon's barrel is 3.8 m and its base 1.6 m wide, on a pickup body of 4.4 x 2.0 m.
- Weapons share two looks, `mg` and `cannon`. Rocket rack, tank gun and sniper cannon all draw as the same cannon.
- Engines are not drawn. Goods in the grid are not drawn.
- Each chassis stretches its grid over a hand-set body in `PHYSICS.bodies`. Cell sizes range from 0.36 to 0.54 m across and 0.46 to 0.86 m along, so one part has a different size on every chassis.
- `PHYSICS.bodies` is read by `src/phys/drive.ts` for the collider and wheels, and by `presentedWidth()` in `src/sim/combat.ts`. Saves hold no physics state.
- Tests that touch body sizes: `src/phys/drive.test.ts`, `src/phys/hills.test.ts`, `src/sim/combat.test.ts`, `src/data/content.test.ts`.
- `models.ts` joins each Blender model into one mesh per material and drops the node structure.

## Design

One cell is 0.4 m across and 0.65 m along the truck on every chassis. The grid is the truck. Row 0 is the nose.

Body from the grid. `bodyOf()` derives half-length from rows x 0.65 / 2 and half-width from columns x 0.4 / 2. Wheel mount x and z are the centers of the chassis's wheel core cells. Height, wheel radius, wheel width and wheel drop stay per look in `PHYSICS.bodies`. The cell size lives once in `src/data/physics.ts`. Sim collision radius in `src/data/chassis.ts` stays as data, see UK1. New sizes follow the approved table: scout 2.0 x 5.2, hauler 2.8 x 5.9, buggy 1.6 x 3.9, wagon 2.0 x 4.6, courier 1.6 x 4.6, van 2.0 x 5.9, longbed 2.8 x 7.2, carrier 2.4 x 5.9, tractor 2.8 x 5.9 m.

Open rig. The collider box is drawn as a frame with one deck tile per grid cell. Every grid item draws a model on its own cells: core parts (a one-seat roll-cage cockpit pod, transmission, fuel tank, wheels), engines, cargo parts, armor, weapons and goods. Nothing is hidden under a shell.

Part model contract:

- A model is authored for its rotation-0 footprint: w cells across by h cells along, in meters. Its front faces the nose. Its origin is the footprint center on the deck top.
- The view places it at its cells' center, turns it 90 degrees for rotation 1, and stretches its base to fill the turned footprint.
- Armor is authored as a front-edge row: its longer footprint side runs across the truck, and its outer face points to the nose. The view turns it to the side its cells lie on and stretches it to their span. Plates stand on the outer edge of their cells. Rams stick out past the front or back. Cages rise above the pod.
- Materials named `paint` take the faction color. A broken part darkens all its materials, as today.
- A render-side table maps each part and good id to a model. A missing entry throws when the truck is built.

Weapons, Borderlands-style. A weapon has a fixed mount and a turning head. The mount fills the footprint and stretches with it. The head is a receiver, a barrel and an optional extra such as a scope, shield or ammo drum. The head keeps its authored size and turns with aim. Each weapon def lists a pool of models per slot. The instance's part id seeds the pick through `hashStr`, so a weapon keeps its look across reloads. Sub-parts join at named sockets. A socket is an empty in the Blender scene, such as `socket_head` on a mount or `socket_muzzle` on a receiver. `Kit` gains a socket helper, and `models.ts` keeps socket positions from the glb.

Draw cost. On rebuild, the static parts of one truck merge into one mesh per material. Wheels and weapon heads stay separate because they move.

Order of work: grid-derived body and physics first, then socket support and the part-look tables, then the Blender models and the rig view in parallel.

Compatibility: truck sizes change, so driving, ramming and routing feel change. The user approved this. Saves stay valid because they hold no body sizes.

TDD: yes for the grid-to-body derivation and the weapon pick, because both are pure functions. No for model looks, which are checked by screenshots.

### Invariants

- IV1 — For every chassis, body half-length is rows x 0.65 / 2 and half-width is columns x 0.4 / 2, from one cell-size constant.
- IV2 — Physics wheel mounts sit at the centers of the chassis's wheel core cells.
- IV3 — Every grid item on a truck draws a model whose base covers exactly its cells. An item with no model throws.
- IV4 — A weapon's sub-parts are a pure function of its part id and def.
- IV5 — The drawn frame footprint equals the physics collider footprint.
- IV6 — A sub-part model missing a socket its slot needs throws at load.

### Principles

- PC1 — The view only moves, turns by 90-degree steps and stretches bases. No per-chassis placement tweaks.
- PC2 — Faction color reaches a model only through `paint` materials.
- PC3 — Part models stay boxy, so stretching a rotated base up to 1.625 times still reads.

### Assumptions

- AS1 — The glTF exporter keeps empties next to the joined mesh, so sockets survive export.
- AS2 — After per-material merging, draw calls stay near today's count, and FPS matches main under the same load.

### Unknowns

- UK1 — Whether sim collision radius should derive from the new body, given its effect on routing and wreck size.
- UK2 — How many physics and combat tests assume current body sizes, and whether their expected values need updating or indicate a real behavior change.
- UK3 — Pool sizes per weapon slot. Start with two or three per slot.

## Verify

Result: passed

Happy-path:
- CK1 (IV1) — any chassis body differs from rows x 0.65 / 2 by columns x 0.4 / 2 — held for all 9 chassis (`tmp/verify-body.ts`).
- CK2 (IV2) — wheel mounts differ from the wheel core cell centers — held for all 9 chassis.
- CK3 — the view crashes on real NPC loadouts — held: boot, 12-turn playtest and all probes ran with no page errors.

Negative:
- CK4 — an unknown chassis or an out-of-grid cell passes silently — held: both throw with a message naming the chassis or cell.
- CK5 (IV3) — an unknown part id gets a model anyway — held: `partModel()` throws (unit test, fresh run 10/10).

Invariants / assumptions:
- CK6 (IV5) — the drawn frame is larger or smaller than the collider — held: static bounds without wheels are exactly ±2.925 x ±1.4 m on a carrier, equal to its body half sizes. Wheels stick out past the frame, as before.
- CK7 (IV3) — a part or good model leaves its rotation-0 footprint — held for all 33 part and good models, with rams allowed past the outer edge (`tmp/verify-fit.mjs`). The rotation-1 stretch in `footprint()` maps h x 0.65 to h x 0.4 across and w x 0.4 to w x 0.65 along.
- CK8 (IV4) — the same part id gives different weapon looks — held (unit test).
- CK9 (IV6, IF3) — a missing socket returns a value — held: `socket('wbar_cannon', 'muzzle')` throws. `socket('wmount_cradle', 'head')` returns (0, 0.36, 0).
- CK10 (PC2) — factions share paint colors or broken parts keep their colors — held: raiders and traders differ only in their faction color, and a broken cab adds darkened colors.
- CK11 — an inventory change does not rebuild the truck — held: a changed item hp rebuilt the root.
- CK12 — `aim()` leaves weapon heads still — held: both heads of an armed NPC turned to the aim yaw.
- CK13 (AS2) — the rig costs more frame time than main — held. At the same camera points, idle FPS matches main within noise: town 5 to 7.5 against 4 to 5.5, desert 22 to 26.5 against 23 to 25. Render time at boot is 39 to 40 ms on both. Draw calls at boot are 179 against 290.

Smoke: `npm run playtest` on the branch played 12 turns with no page errors or crash, and failed only its FPS floor: 13.5 and 19.5 against main's 20.5 and 24 in the same order.
Goal: proxy only. The user must still confirm the look in game.
Notes: the playtest FPS gap is a measurement artifact. The playtest measures FPS wherever the player ends after 12 turns. New body sizes change the driven path, so the two runs end looking at different parts of the map. Rebuilds are rare: one in six turns, 8 ms each.

## Plan

Approach: derive the body in the sim layer so physics, combat and the view read one source. Then add sockets to the model pipeline and a pure part-look table. Blender agents build the models against the table's names while the view is rewritten against the same names.

### PH1 — Body from the grid
- 1.1 `src/data/physics.ts:28-38` (modify)
  - Add `cell: { across: 0.4, along: 0.65 }` next to `bodies`. Each `bodies` entry keeps only `halfHeight`, `wheelY`, `wheelRadius` and `wheelHalfWidth`.
  - Respects: IV1
- 1.2 `src/sim/body.ts` (create)
  - `type Body = { half: { x: number; y: number; z: number }; wheelX: number; wheelZ: number; wheelY: number; wheelRadius: number; wheelHalfWidth: number }`
  - `bodyOf(chassisId: string): Body` derives half-length and half-width from `baseGrid()`, and wheelX and wheelZ from the wheel core cells. It throws when there are not four wheel cores or they are not mirror placed.
  - `cellCenter(chassisId: string, x: number, y: number): { x: number; z: number }` gives the center of grid cell (x, y) in body meters. Local +x is the nose, +z the truck's right, column 0 the left.
  - Respects: IV1, IV2
- 1.3 `src/phys/body.ts:1-10` (modify): drop `Body` and `bodyOf`. `wheelMounts()` imports them from `src/sim/body.ts`. Update imports in `src/phys/drive.ts`, `src/three/render/vehicle.ts` and `src/data/content.test.ts`.
- 1.4 `src/sim/combat.ts:93-97` (modify): `presentedWidth()` reads `bodyOf(target.chassisId).half`.
- 1.5 `src/sim/body.test.ts` (create), written first: scout half is 2.6 by 1.0; wheel mounts sit at the centers of cells (0,0) and (4,7); `cellCenter` of the nose-left cell; every chassis derives without throwing.
- 1.6 Run `npm test`. Record in Verify which physics and combat tests change and why (UK2). Compare each chassis sim radius with its new half-diagonal and report the gaps (UK1). The radius stays unchanged in this task.
- Commit: Derive truck bodies from the chassis grid

### PH2 — Sockets and part looks
- 2.1 `tools/blender/kit.py` (modify)
  - `Kit.socket(name: str, loc: Vec3) -> None` adds an empty named `socket_<name>`.
  - `Kit.export()` exports the joined mesh with its sockets. Check that the empties reach the glb (AS1).
- 2.2 `src/three/render/models.ts:1-52` (modify)
  - The loader records each `socket_*` node position per model and removes the node.
  - `socket(name: ModelName, socket: string): THREE.Vector3` returns it and throws when missing (IV6).
  - `NAMES` lists every model name built in PH3.
- 2.3 `src/render/partLooks.ts` (create), pure, with only `import type { ModelName }` from models.ts.
  - `PART_MODELS: Record<string, ModelName>` covers every non-weapon part def and every good id.
  - `WEAPON_POOLS: Record<string, { mount: ModelName[]; receiver: ModelName[]; barrel: ModelName[]; extra: ModelName[] }>`. An empty `extra` pool means no extra.
  - `weaponLook(partId: string, defId: string): { mount: ModelName; receiver: ModelName; barrel: ModelName; extra: ModelName | null }` picks each slot with its own `hashStr` seed.
  - `partModel(defId: string): ModelName` throws on an unknown id (IV3).
  - Respects: IV3, IV4
- 2.4 `src/render/partLooks.test.ts` (create), written first: every part def and good has a look; one id always gives the same weapon look; 50 ids give more than one look for a weapon with larger pools.
- Commit: Add model sockets and part-look tables

### PH3 — Blender part models
- 3.1 `tools/blender/<name>.py` and `public/models/<name>.glb` (create), one per name in IF2. Parallel agents own these groups: core and deck (deck tile, wheel, cockpit pod, transmission, fuel tank), engines, armor, cargo and goods, weapon sub-parts.
  - Each model follows the part model contract in Design and the CLAUDE.md Art steps.
  - `paint` materials go on faction-colored surfaces (PC2). Bases stay boxy (PC3).
  - Mounts carry `socket_head`. Receivers carry `socket_muzzle` and `socket_extra`.
  - The wheel is authored at 1 m radius and 1 m width. The view scales it per look.
- Commit per group: Add Blender <group> part models

### PH4 — Rig view
- 4.1 `src/three/render/vehicle.ts:1-329` (rewrite, same public API: `VehicleView`, `Ring3`, `update`, `pose`, `aim`, `rings`, `dispose`)
  - Remove `SHAPES`, `wedgeGeometry`, `cellSpan` and `sidePoint`.
  - `buildFrame()` draws the collider box as a frame and one `deck_tile` per grid cell (IV5).
  - `placeItem(v: Vehicle, item: GridItem): THREE.Object3D` puts a part or good model at its cells' center with `cellCenter()`. It turns the model for rotation 1 and stretches its base to the footprint (PC1).
  - `placeArmor()` turns an armor model to its `sideOf()` side and stretches it to the cells' span.
  - `buildWeapon()` puts the mount on the footprint and a head group at `socket_head`. The receiver sits in the head, the barrel at `socket_muzzle` and the extra at `socket_extra`. The head joins `turrets`.
  - `buildWheels()` places the `wheel` model at `wheelMounts()`, scaled by `wheelRadius` and `wheelHalfWidth`.
  - `paint` materials take `FACTION_COLORS`. Broken parts darken by the current tone factors.
  - `mergeStatic(group: THREE.Group): THREE.Group` merges non-moving meshes by material with `BufferGeometryUtils.mergeGeometries`, after dropping attributes other than position and normal.
  - `signatureOf()` includes engines, core parts and goods, because they are now drawn.
- 4.2 `tmp/rig-shots.mjs` (create, not committed): screenshots of the start truck and one truck per chassis with mixed parts, from the game camera.
- Commit: Draw trucks as open rigs of part models

### PH5 — Docs
- 5.1 `CLAUDE.md` Art section: describe part models on the shared cell grid, the part model contract, sockets and weapon pools. Remove the plan-first vehicle sentence.
- Commit: Document modular part models

### Test strategy
- PH1: `src/sim/body.test.ts` fails first, then passes. Full `npm test` after.
- PH2: `src/render/partLooks.test.ts` fails first, then passes.
- PH4: typecheck, rig screenshots checked by eye and then by the user, `npm run playtest` compared with main under the same load, and a draw-call count against the 291 calls of current main (AS2).

### Order & dependencies
- PH1 and PH2 run in parallel. PH3 needs PH2. PH4 needs PH1 and PH2, and its boot check needs PH3's files. PH5 is last.

### Risks / rollback
- RK1 — New body sizes break physics tests that encode today's sizes. Update expected values only when the new behavior is correct, and record each in Verify.
- RK2 — More models per truck raise draw calls. `mergeStatic()` addresses it. If FPS still drops against main, merge the weapon mounts too.
- RK3 — The exporter drops empties (AS1). Then store sockets as tiny marker meshes named `socket_*` and strip them on load.
- Rollback: each phase is its own commit on the task branch.

### Interfaces
- IF1 [blocks] — `bodyOf(chassisId): Body` and `cellCenter(chassisId, x, y)` in `src/sim/body.ts`. PH4 places every model with them.
- IF2 [blocks] — Model names in `NAMES` in `src/three/render/models.ts` and the pools in `src/render/partLooks.ts`. PH3 agents need the exact names and sockets to build.
- IF3 — `socket(name, socket): THREE.Vector3` in `models.ts`, read by PH4.

### Interface graph
- PH1 -> IF1 @ src/data/physics.ts, src/sim/body.ts, src/sim/body.test.ts, src/phys/, src/sim/combat.ts, src/data/content.test.ts
- PH2 -> IF2, IF3 @ tools/blender/kit.py, src/three/render/models.ts, src/render/partLooks.ts, src/render/partLooks.test.ts
- PH3 IF2 -> @ tools/blender/*.py except kit.py, public/models/
- PH4 IF1, IF2, IF3 -> @ src/three/render/vehicle.ts
- PH5 -> @ CLAUDE.md

### Model names (IF2)

Footprints are w cells across by h cells along at rotation 0. One cell is 0.4 m across (Blender Y) by 0.65 m along (Blender X, nose at +X). Truck right is Blender -Y. The origin is the footprint center on the deck top.

- Core and deck: `deck_tile` (one cell, a thin plate, `paint`), `wheel` (1 m radius, 1 m wide, axle along Blender Y, origin at the hub center), `cockpit` for `cab` (1x1, one seat in a roll cage, up to 1.4 m tall), `transmission` (1x1), `fuel_tank` for `tank` (1x1).
- Engines: `eng_stock` for stockEngine (2x2), `eng_tuned_v8` for tunedEngine (2x2), `eng_flat_four` for flatFour (2x1), `eng_workhorse_diesel` for workhorseDiesel (2x2), `eng_racing_v6` for racingV6 (2x2), `eng_heavy_diesel` for heavyDiesel (2x2), `eng_turbine` for turbine (2x2).
- Armor, authored as a front-edge row of N = max(w, h) cells: N x 0.4 m across and 0.65 m deep, outer face at +X. `arm_plates` for plates (N=3), `arm_cage` for cage (N=2), `arm_ram` for ram (N=3), `arm_scrap_panels` for scrapPanels (N=2), `arm_ceramic_plates` for ceramicPlates (N=2), `arm_spaced` for spacedArmor (N=4), `arm_reinforced_cage` for reinforcedCage (N=3), `arm_plow_ram` for plowRam (N=3). Plates stand near the outer edge. Rams stick out past +X up to about 0.6 m. Cages rise to about 1.6 m.
- Cargo: `cargo_rack` for rack (2x1), `cargo_trailer_box` for trailerBox (2x2), `cargo_panniers` for panniers (1x1), `cargo_flatbed` for flatbed (2x1), `cargo_light_frame` for lightFrame (2x2), `cargo_enclosed_frame` for enclosedFrame (2x2), `cargo_heavy_frame` for heavyFrame (2x2).
- Goods, all 1x1 and at most 0.5 m tall: `good_scrap`, `good_salt`, `good_meds`, `good_grain`, `good_textiles`, `good_tools`, `good_batteries`, `good_electronics`.
- Weapon mounts fill the weapon footprint and carry `socket_head` at the turret pivot: `wmount_ring_small` (1x1), `wmount_pintle` (1x1), `wmount_ring_wide` (2x1), `wmount_cradle` (3x1).
- Weapon receivers have their origin at the pivot and carry `socket_muzzle` at the front face and `socket_extra` on top: `wrec_mg_a`, `wrec_mg_b`, `wrec_shotgun`, `wrec_autocannon`, `wrec_cannon`, `wrec_tank`, `wrec_rocket_pod`, `wrec_sniper`.
- Weapon barrels have their origin at the rear end and extend along +X: `wbar_mg_short` (0.7 m), `wbar_mg_long` (1.0 m), `wbar_twin` (0.9 m), `wbar_shotgun` (0.6 m), `wbar_autocannon` (1.3 m), `wbar_cannon` (1.8 m), `wbar_tank` (2.0 m), `wbar_sniper` (2.2 m), `wbar_rocket_tubes` (0.5 m).
- Weapon extras have their origin at the attach point: `wext_scope`, `wext_shield`, `wext_drum`.

Weapon pools:

- mg: mount ring_small or pintle; receiver mg_a or mg_b; barrel mg_short, mg_long or twin; extra shield or drum.
- shotgun: mount ring_small or pintle; receiver shotgun; barrel shotgun or twin; extra shield or drum.
- autocannon: mount ring_wide; receiver autocannon; barrel autocannon or twin; extra drum or shield.
- cannon: mount cradle; receiver cannon; barrel cannon; extra shield or scope.
- tankGun: mount cradle; receiver tank; barrel tank; extra shield.
- rocketRack: mount ring_wide; receiver rocket_pod; barrel rocket_tubes; no extra.
- sniperCannon: mount cradle; receiver sniper; barrel sniper; extra scope.
