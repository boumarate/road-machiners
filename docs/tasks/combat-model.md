# Combat model

**Status:** planning
**Branch:** combat-model
**Worktree:** .worktrees/combat-model
**Goal:** In a real game, the player can set a ram course on an enemy and hit it. Hovering an enemy shows both sides' hit chances with their causes. Machine guns fire bursts of separately rolled rounds. Every hit or ram breaks named parts, and armor on the struck side matters. Garage loadout mass visibly changes speed, handling and ram damage. The user confirms the fights feel decent by playing.
**Mode:** interactive

## Context
- Hit chance is one additive line in `src/sim/combat.ts:44`: weapon accuracy minus range falloff, target speed and aim penalty. Size, own speed and facing play no part.
- A weapon fires one roll per turn. A hull shot deals flat `damage` minus a global armor `reduction`. Armor has no sides.
- Vehicles have an abstract `hull` pool. It appears in 24 files, including defeat, repair prices and the HUD.
- Armor parts add hull, a flat reduction and a part shield. The garage grid has one `A` mount letter, so a plate has no side.
- Mass exists twice. `CHASSIS[].mass` is a unitless ratio used by crash damage. `PHYSICS.bodies[].mass` is kilograms used by Rapier. Parts and goods weigh nothing. Cargo slows the truck through `speedPenalty`.
- The driver routes around other trucks, and click orders only name ground points, so the player cannot aim a ram.
- Crash damage in `src/sim/movement.ts:137` is `impact × massRatio × collisionDamage`, on hull, with a random part hit. Rapier gives the contact point, so the struck side can be known.
- Body sizes in meters already exist per chassis look in `src/data/physics.ts`.
- There are no save files, so data shapes can change freely.

## Design

There is no hull. A truck is its parts, laid out in the garage grid as a top view with the nose up. Every hit breaks something specific.

Built-in parts. Each chassis layout places fixed parts that cannot be removed, only repaired: cab, transmission, wheels and fuel tank. Engine, weapons, armor, rams and cargo stay swappable. A broken part has one clear effect:
- Engine or transmission: no drive, the truck coasts.
- Wheels: steering and top speed drop.
- Fuel tank: fuel leaks each turn.
- Weapon: cannot fire.
- Cargo part: goods on its extra rows are lost.
- Cab: the crew is out. For NPCs the truck becomes a wreck. For the player it is defeat. Damage to the player's cab also hurts the character's health.

Four formulas drive all of combat. Each lives in one sim module and reads numbers from `src/data`.

F1 mass. Vehicle mass is chassis mass plus every item on board: parts, mounted or spare, and goods. Rapier gets this mass. The engine gives a fixed force, so acceleration and braking fall as mass grows. Top speed and steering scale by the load factor `sqrt(ratedMass / mass)`, capped at 1. Cargo `speedPenalty` goes away; weight does its job.

F2 hit chance. Each round leaves the gun with a random angular error. It hits when the error is smaller than the target's half-width as seen from the gun.
- Target half-angle = presented width / (2 × distance). Presented width comes from body length and width and the angle the target shows. A truck seen broadside is a bigger target than one seen head-on.
- Spread = weapon spread × (1 − gunnery) + lead error × crossing speed / projectile speed + shake × own speed. Crossing speed is the part of relative velocity across the line of fire.
- Hit chance = erf(half-angle / (spread × √2)), clamped to the existing min and max. An aimed shot at a part uses that part's width.
Distance, size, relative speed, facing, weapon quality and skill all come out of this one line.

F3 penetration. A round enters the grid from the struck side: front, rear, left or right. The side is the one facing the shooter. Its lane across the grid comes from where the round landed across the target's width. The round walks the lane cell by cell. Each part it meets takes damage and subtracts its armor from the round's penetration. The round stops when penetration runs out. Armor plates have high armor and many hit points, so they soak rounds until they break. Front and rear lanes are long and pass the engine and cab; side lanes are short. Chassis layouts put plates' natural spots on the nose and tail.

F4 ram. On contact, closing speed u along the contact line gives each vehicle raw energy K × u × other mass / both masses. The light truck takes the bigger share. The energy enters the struck side like a wide round: it hits every lane on that side at low penetration. A ram part on the striking side is the first thing in those lanes, with high armor. It also multiplies the energy dealt to the other truck.

Ram order. Ramming is a move order, like driving to a point. Press R, then click a truck. The driver aims at where the target will be, from its current position and velocity, and re-aims every physics step. It drives straight, at full speed, and does not route around the target or avoid it. The order clears after contact with the target, when the target is gone, or on a new order. The path preview shows the ram course, since it runs the same physics.

Projectiles. A weapon shot fires `rounds` rounds, each with damage, penetration, speed and splash radius. Each round rolls F2 separately and shows as its own bolt. MG: many light rounds, low penetration. Cannon: one heavy round with splash. A round that misses lands beside the target by its sampled error. Splash damages parts in cells near the landing point, on any vehicle within its radius.

Garage sides. The layout letter `A` becomes `F`, `B`, `L` and `R`. Plates and rams mount on any side letter. A part spanning two letters does not mount.

Hover. Hovering a truck shows a card. It lists each of my weapons with its hit chance on that truck, and each of its weapons with its hit chance on me. Under each chance, the card lists the causes: distance, presented width, crossing speed, own speed, weapon spread, skill.

Proposed extra variables, all inside the formulas above: facing, crossing speed instead of plain speed, own speed, projectile speed. Left out for now: cover behind obstacles, height advantage, ammo counts.

Repair in town prices each damaged part. The HUD shows part health instead of a hull bar.

TDD: yes. Each formula is a pure function with clear expected numbers.

### Invariants
- IV1 — Vehicle mass is computed in one sim function. Rapier, stats, crash damage and the UI all read it.
- IV2 — Body sizes come only from `PHYSICS.bodies`. Hit chance and rendering use the same dimensions.
- IV3 — Every damage source, round, splash or ram, goes through one lane-walk function.
- IV4 — The hover card numbers come from the same function the fire phase rolls against.
- IV5 — Combat randomness goes through `src/sim/rng.ts`, so the physics preview and turn stay deterministic.
- IV6 — No `hull` field remains on vehicles or chassis.

### Principles
- PC1 — New numbers go in `src/data`, one place each. Tests assert formula shapes, not tuned values.
- PC2 — If a chassis or part lacks a new field, the game throws at load.

### Assumptions
- AS1 — Rapier accepts a new body mass when the loadout changes, through `syncDrive`, without a rebuild.

### Unknowns
- UK1 — Tuned numbers for masses, armor, penetration and spread. Planned as a first pass, then tuned by play.
- UK2 — How NPC AI should use facing, such as showing its front. First pass keeps current AI.

## Plan

Approach: build bottom-up in six phases. Mass comes first, since stats and physics depend on it. Then the part grid with sides and built-in parts, then damage without hull, then hit chance and rounds, then rams, then the UI. Each phase keeps the game playable and all tests green. Choices that narrow the design are marked "Narrowed".

### PH1 — Mass (F1)
- 1.1 `src/data/parts.ts`, `src/data/goods.ts`, `src/data/chassis.ts` (modify)
  - Every `PartBase` gets `mass` in kg. Every `GoodDef` gets `mass` per unit in kg.
  - `ChassisDef.mass` becomes kg. New `ratedMass` in kg is the loaded mass the chassis numbers assume.
  - Remove `CargoDef.speedPenalty` and `ArmorDef.speedPenalty`.
- 1.2 `src/data/physics.ts:37-42` (modify): remove `mass` from `bodies`. Body sizes stay here (IV2).
- 1.3 `src/sim/mass.ts` (create)
  - `vehicleMass(v: Vehicle): number` sums chassis, all part items and all goods (IV1).
  - `loadFactor(v): number` is `min(1, sqrt(ratedMass / mass))`.
- 1.4 `src/sim/stats.ts:38-78` (modify)
  - `maxSpeed` and turn rates scale by `loadFactor`. `accel` and `brake` scale by `ratedMass / mass`.
  - `VehicleStats.mass` is kg from `vehicleMass`.
- 1.5 `src/phys/drive.ts:103-120,187-217`, `src/phys/body.ts` (modify)
  - Body mass, inertia and suspension force read `vehicleMass`.
  - Engine force is `mass × engineAccel × accel / chassis accel`, so real acceleration follows the stats.
  - Brake force scales by `ratedMass`, so heavy trucks brake worse.
  - `syncDrive` resets mass properties every turn (AS1).
- 1.6 `src/sim/movement.ts:120-141` (modify): crash mass ratio reads kg. The formula stays until PH5.
- 1.7 `src/ui/town.ts:160-170` (modify): part lines show mass instead of speed penalty.
- Tests
  - `src/sim/mass.test.ts` checks sums and load factor.
  - `src/phys/drive.test.ts` checks a truck loaded with scrap covers less distance from rest than an empty one.
- Commit: Vehicle mass from chassis, parts and goods drives speed, handling and physics

### PH2 — Side mounts and built-in parts
- 2.1 `src/data/parts.ts` (modify)
  - New `PartKind` `core`: `CoreDef = PartBase & { kind: 'core'; role: 'cab' | 'transmission' | 'wheel' | 'tank' }`. Defs are `cab`, `transmission`, `wheel` and `tank`.
  - Every part def gets `armor`, the penetration it stops.
  - `ArmorDef` drops `hullBonus`, `reduction` and `partShield`, and gets `ramMult`.
  - Armor defs are `plates` and `cage`, plus a new `ram` with high armor and `ramMult` above 1.
- 2.2 `src/data/chassis.ts` (modify)
  - Layouts are top views with the nose on row 0.
  - Mount letter `A` becomes `F`, `B`, `L` and `R` on the matching edges. `X` marks built-in cells.
  - `ChassisDef.core: { defId: string; x: number; y: number }[]` places the built-in parts:
    - the cab near the front
    - the transmission in the middle
    - four 1×1 wheels at the corners
    - the tank at the rear
  - `ChassisDef.hull` is removed.
- 2.3 `src/sim/grid.ts:7-60` (modify)
  - `Cell` adds `F`, `B`, `L`, `R` and `X`.
  - `MOUNT_CELLS: Record<PartKind, Cell[]>` maps armor to `F`, `B`, `L`, `R` and core to `X`.
  - `isMounted` needs all covered cells to share one allowed letter.
  - `sideOf(v, part): Side | null` gives the side letter under a mounted armor part.
- 2.4 `src/sim/factory.ts:31-58` (modify): `makeVehicle` places core parts at their fixed spots first. It throws if a spot does not fit.
- 2.5 `src/sim/inventory.ts` and `src/sim/economy.ts:buyChassis` (modify)
  - `moveItem` and `storePart` throw on core parts.
  - `buyChassis` drops the old core parts and builds the new chassis's core parts.
- 2.6 `src/ui/inventory.ts` (modify): side letters and built-in parts are drawn distinctly. Built-in parts cannot be dragged.
- Tests
  - Every chassis builds with all core parts mounted.
  - Armor mounts on each side letter.
  - A part spanning two letters is not mounted.
  - Moving a core part throws.
- Commit: Garage grid as a top view with side armor mounts and built-in parts

### PH3 — Part damage replaces hull (F3)
- 3.1 `src/sim/armor.ts` (create)
  - `type Side = 'front' | 'rear' | 'left' | 'right'`.
  - `sideToward(v: Vehicle, p: Vec): Side` picks the side by bearing in the vehicle frame.
  - `laneCount(v, side): number`.
  - `type PartHit = { part: string; damage: number }`.
  - `walkLane(world, v, side, lane, hit: { damage: number; pen: number }): PartHit[]` is the only way damage reaches parts (IV3):
    - It walks grid cells in from the side edge.
    - A working part takes `damage × min(1, pen / armor)` and lowers `pen` by its armor.
    - The walk stops at zero pen.
    - Broken parts and goods let the round pass.
- 3.2 `src/sim/damage.ts` (modify)
  - Delete `damageHull`.
  - `damagePart` also cuts player health by `RULES.cabHealthShare` of cab damage.
- 3.3 Part effects in `src/sim/stats.ts` (modify)
  - A broken transmission acts like a broken engine, with speed capped at `RULES.disabledEngineSpeed`. Narrowed: the design said coast. The crawl keeps the limp home that a broken engine gives today.
  - Each broken wheel scales speed and turn by `1 − RULES.wheelLoss`.
  - A broken tank leaks `RULES.tankLeak` fuel per turn, in `src/sim/supplies.ts`.
  - A broken cargo part has no extra effect. Narrowed: goods loss is dropped to keep the task smaller.
- 3.4 Knockout (modify)
  - `src/sim/combat.ts:resolveDestroyed` wrecks NPCs whose cab is at 0 hp.
  - `src/sim/defeat.ts` triggers when the player's cab is at 0 hp or health is 0. It then patches every broken core part and the engine to `RULES.defeatPatch` of max hp.
- 3.5 Remove hull (IV6)
  - Remove `Vehicle.hull` from `types.ts`, and its uses in `factory.ts` and `inventory.ts:afterRefit`.
  - In `economy.ts`, repair prices parts only. Trade-in scales by mean core part health.
  - `hud.ts` shows a cab bar and a count of broken parts.
  - In `town.ts` and `three/game.ts:47,549,573`, a truck smokes when its cab is under `HURT_CAB` or any part is broken.
  - Remove `ECONOMY.hullRepairPerHp`.
  - Rename the `Aim` value `'hull'` to `'body'`, meaning aim at the truck, not a part.
- Tests in `src/sim/armor.test.ts`
  - The side choice is correct.
  - A plate absorbs a weak round, and a strong round passes through.
  - A broken part lets the round pass, and the round stops at zero pen.
  - Cab death wrecks an NPC, and player cab death triggers defeat.
  - Tank leak, wheel loss and transmission effects apply.
- Commit: Hits damage parts along lanes; cab loss ends the fight; hull removed

### PH4 — Hit chance and rounds (F2)
- 4.1 `src/data/parts.ts` `WeaponDef` (modify)
  - It drops `accuracy` and `damage`.
  - It gets `spread` in degrees, `rounds`, and `round: { damage; pen; speed; splashRadius; splashDamage; splashPen }`.
  - Every weapon states every field. The MG has splash radius 0 (PC2).
- 4.2 `src/data/rules.ts` (modify)
  - It drops `rangeFalloff`, `speedEvasion` and `aimedPenalty`.
  - It adds `leadError`, `shake`, and `cellMeters`, which sizes a part from its grid footprint.
- 4.3 `src/sim/combat.ts:41-80` (modify)
  - `hitOdds(world, shooter, mw, target, aim): HitOdds` returns `chance`, `distance`, `width`, `halfAngle`, `spread`, and `causes: { weapon; crossing; own; skill }` in radians.
  - Presented width comes from `PHYSICS.bodies` and the facing angle. An aimed part uses its footprint.
  - Crossing speed uses both vehicles' speed and heading at the fire phase.
  - `erf` is a small local helper.
- 4.4 `fireWeapons` rolls each round (IV5)
  - The angular error comes from a Gaussian drawn in `src/sim/rng.ts`, through a new `gauss(world)`.
  - A hit maps its offset to a lane on `sideToward(target, shooter.pos)` and calls `walkLane`. An aimed hit uses the part's lane.
  - A miss with splash lands `offset` beside the target. Splash reaches lanes on that side whose edge cells lie within the radius, at splash damage and pen.
  - Narrowed: splash hits the target only, not other trucks nearby.
- 4.5 Shot event and readers (modify)
  - In `src/sim/types.ts`, `shot` becomes `{ t: 'shot'; shooter; weapon; target; aim; chance; side; rounds: { hit: boolean; offset: number; hits: PartHit[] }[] }`.
  - `src/ui/format.ts` logs hits out of rounds, plus damaged part names.
  - `src/ui/weapons.ts` reads `hitOdds`.
- Tests in `src/sim/combat.test.ts`
  - Chance falls with distance and rises when the target is broadside.
  - Crossing speed lowers chance, and head-on closing does not.
  - Faster rounds and gunnery raise chance. Own speed lowers it.
  - The MG fires `rounds` independent rolls.
  - The same seed gives the same rounds.
  - A cannon miss within splash radius damages a part.
- Commit: Hit chance from target angular size and spread; weapons fire rounds

### PH5 — Rams (F4)
- 5.1 `src/sim/movement.ts:applyCrash` (modify), with signature `applyCrash(world, a, b: Vehicle | null, what: string, from: Vec, impact: number)`
  - `from` is the other body's center. The side comes from `sideToward`.
  - Each truck's energy is `RULES.ramDamage × impact × other mass / both masses`. An obstacle counts as infinite mass, so its share is 1.
  - The energy spreads over every lane of the struck side through `walkLane`, at `RULES.crashPen`.
  - A ram part on the other truck's striking side multiplies that energy by its `ramMult`.
  - The old 2D `resolveMovement` path calls the same function.
- 5.2 `src/phys/turn.ts:43-49` (modify): passes `from` for a vehicle, an obstacle or the nearest map edge point.
- 5.3 The collision event gets `hitsA: PartHit[]` and `hitsB: PartHit[]` instead of damage numbers. `format.ts` updates to match.
- 5.4 `src/sim/types.ts:MoveOrder` (modify): adds `{ kind: 'ram'; targetId: string }`. `setMoveOrder` in `src/sim/world.ts` throws on an unknown or own target.
- 5.5 `src/phys/drive.ts:planTurn,driveStep` (modify): a ram plan has no route and full target speed. Each step aims at the target body's position plus its velocity times the time to close. `results` marks `rammed` when a crash pairs the car with its target.
- 5.6 `src/phys/turn.ts:applyTurn` (modify): clears a ram order on `rammed` or a missing target.
- 5.7 `src/three/game.ts:onLeftClick` and key handler (modify): R arms ram mode, and a click on a truck sets the ram order. Esc or a ground click disarms. The HUD shows "Ram: click a truck" while armed. `src/three/render/path.ts` draws the ram course in the hostile color.
- Tests
  - A ram order drives into a moving target within two turns and clears.
  - A light truck takes more damage than a heavy one in a head-on crash.
  - A front ram takes the hit before the cab.
  - A ram raises damage to the other truck.
  - A rear hit lands on rear lanes.
- Commit: Rams split damage by mass and hit the struck side's parts; ram order aims at a moving truck

### PH6 — Hover card and visuals
- 6.1 `src/ui/hitCard.ts` (create)
  - `HitCard.render(world, hoveredId)` shows my weapons' odds on the hovered truck. It also shows its weapons' odds on me. Both come from `hitOdds` (IV4).
  - Causes read as plain facts, such as "18 m away" or "shows 4.1 m wide".
  - The scatter line reads like "weapon 2.0°, crossing +1.1°, own speed +0.4°, gunnery −0.3°".
  - Narrowed: causes show in degrees of scatter, because the percent question is still open.
- 6.2 `src/three/game.ts` (modify)
  - Feeds hover to the card, and hides the card during playback.
  - Combat playback spawns one bolt per round from `rounds`, staggered within `VITE_COMBAT_SHOT_MS`.
  - A missed bolt lands at `offset` beside the target.
- 6.3 `src/three/render/fx.ts` (modify): `shot` takes a landing point instead of a hit flag.
- 6.4 `src/three/render/vehicle.ts:185-200` (modify): plates are drawn on their side, and a ram is a wedge on its side.
- Verify: the playtest passes. Screenshots of the hover card, the garage and a burst go to the user.
- Commit: Hover card with hit odds and causes; per-round bolts; side armor visuals

### Test strategy
- TDD per phase as listed. Formula tests come first and assert shapes, such as "falls with distance", not tuned values (PC1).
- After PH6, run `npm test`, `npm run typecheck` and `npm run playtest`.
- Also after PH6, a Playwright script in `tmp/` sets up a fight and hovers the enemy.

### Order & dependencies
- The phases run strictly in order, PH1 to PH6. They share `parts.ts`, `stats.ts` and `types.ts`.
- Each phase sets first-pass numbers, which are tuned by play after PH6 (UK1).
- AI keeps its current behavior (UK2).

### Risks / rollback
- RK1 — Removing hull touches 24 files. PH3 fails typecheck until it is complete, so it lands as one commit.
- RK2 — Loaded trucks may stall on hills in physics. A PH1 drive test checks that a full hauler still climbs the test hill.
- RK3 — Lane walks may make fights too long or too short. The PH6 playtest checks that MG fire kills a buggy within a few turns. Numbers are tuned after.

### Interfaces
- IF1 — `vehicleMass(v: Vehicle): number` in kg, in `src/sim/mass.ts`.
- IF2 — `Side`, `sideToward`, `laneCount`, `walkLane` and `PartHit`, in `src/sim/armor.ts`.
- IF3 — `hitOdds(...) → HitOdds`, in `src/sim/combat.ts`.
- IF4 — The `shot` and `collision` event shapes, in `src/sim/types.ts`.
